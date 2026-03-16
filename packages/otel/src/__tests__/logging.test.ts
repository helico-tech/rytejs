import { SeverityNumber } from "@opentelemetry/api-logs";
import {
	InMemoryLogRecordExporter,
	LoggerProvider,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
	ATTR_COMMAND_TYPE,
	ATTR_DISPATCH_DURATION_MS,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_RESULT,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
} from "../conventions.js";
import { createOtelPlugin } from "../plugin.js";

const definition = defineWorkflow("logging-test", {
	states: {
		Draft: z.object({ items: z.array(z.string()).default([]) }),
		Placed: z.object({ total: z.number() }),
	},
	commands: {
		Place: z.object({ total: z.number() }),
	},
	events: {
		OrderPlaced: z.object({ orderId: z.string() }),
	},
	errors: {
		OutOfStock: z.object({ item: z.string() }),
	},
});

let logExporter: InMemoryLogRecordExporter;
let loggerProvider: LoggerProvider;
let spanExporter: InMemorySpanExporter;
let tracerProvider: BasicTracerProvider;

beforeEach(() => {
	logExporter = new InMemoryLogRecordExporter();
	loggerProvider = new LoggerProvider({
		processors: [new SimpleLogRecordProcessor(logExporter)],
	});

	spanExporter = new InMemorySpanExporter();
	tracerProvider = new BasicTracerProvider();
	tracerProvider.addSpanProcessor(new SimpleSpanProcessor(spanExporter));
});

afterEach(async () => {
	await loggerProvider.shutdown();
	await tracerProvider.shutdown();
});

describe("otel logging", () => {
	test("successful dispatch emits INFO log with correct body", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				logger: loggerProvider.getLogger("ryte"),
			}),
		);
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(true);

		const logs = logExporter.getFinishedLogRecords();
		// dispatch:end emits one dispatch log
		const dispatchLogs = logs.filter((l) => l.body?.toString().startsWith("dispatch "));
		expect(dispatchLogs).toHaveLength(1);

		const log = dispatchLogs[0]!;
		expect(log.severityNumber).toBe(SeverityNumber.INFO);
		expect(log.severityText).toBe("INFO");
		expect(log.body).toBe("dispatch Place \u2192 ok");
	});

	test("domain error dispatch emits WARN log with error category", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				logger: loggerProvider.getLogger("ryte"),
			}),
		);
		router.state("Draft", ({ on }) => {
			on("Place", ({ error }) => {
				error({ code: "OutOfStock", data: { item: "widget" } });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(false);

		const logs = logExporter.getFinishedLogRecords();
		// Error hook emits one error log, dispatch:end emits one dispatch log
		const dispatchLogs = logs.filter((l) => l.body?.toString().startsWith("dispatch "));
		expect(dispatchLogs).toHaveLength(1);

		const log = dispatchLogs[0]!;
		expect(log.severityNumber).toBe(SeverityNumber.WARN);
		expect(log.severityText).toBe("WARN");
		expect(log.attributes[ATTR_ERROR_CATEGORY]).toBe("domain");
	});

	test("unexpected error emits ERROR severity via error hook", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				logger: loggerProvider.getLogger("ryte"),
			}),
		);
		router.state("Draft", ({ on }) => {
			on("Place", () => {
				throw new Error("something went wrong");
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(false);

		const logs = logExporter.getFinishedLogRecords();
		// Error hook log (emitErrorLog)
		const errorLogs = logs.filter((l) => l.body?.toString().startsWith("error "));
		expect(errorLogs).toHaveLength(1);

		const log = errorLogs[0]!;
		expect(log.severityNumber).toBe(SeverityNumber.ERROR);
		expect(log.severityText).toBe("ERROR");
		expect(log.attributes[ATTR_ERROR_CATEGORY]).toBe("unexpected");
	});

	test("dependency error emits ERROR severity via error hook", async () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("connection lost");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				logger: loggerProvider.getLogger("ryte"),
			}),
		);
		router.state("Draft", ({ on }) => {
			on("Place", ({ deps: d }) => {
				(d as typeof deps).db.save();
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(false);

		const logs = logExporter.getFinishedLogRecords();
		const errorLogs = logs.filter((l) => l.body?.toString().startsWith("error "));
		expect(errorLogs).toHaveLength(1);

		const log = errorLogs[0]!;
		expect(log.severityNumber).toBe(SeverityNumber.ERROR);
		expect(log.severityText).toBe("ERROR");
		expect(log.attributes[ATTR_ERROR_CATEGORY]).toBe("dependency");
	});

	test("early-return error (NO_HANDLER) emits log via dispatch:end", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				logger: loggerProvider.getLogger("ryte"),
			}),
		);
		// No handlers registered — dispatch returns NO_HANDLER

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(false);

		const logs = logExporter.getFinishedLogRecords();
		const dispatchLogs = logs.filter((l) => l.body?.toString().startsWith("dispatch "));
		expect(dispatchLogs).toHaveLength(1);

		const log = dispatchLogs[0]!;
		expect(log.severityNumber).toBe(SeverityNumber.WARN);
		expect(log.body).toBe("dispatch Place \u2192 error");
		expect(log.attributes[ATTR_ERROR_CATEGORY]).toBe("router");
		expect(log.attributes[ATTR_ERROR_CODE]).toBe("NO_HANDLER");
	});

	test("log attributes include command type, workflow id, result, and duration", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				logger: loggerProvider.getLogger("ryte"),
			}),
		);
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		const logs = logExporter.getFinishedLogRecords();
		const dispatchLogs = logs.filter((l) => l.body?.toString().startsWith("dispatch "));
		expect(dispatchLogs).toHaveLength(1);

		const log = dispatchLogs[0]!;
		expect(log.attributes[ATTR_COMMAND_TYPE]).toBe("Place");
		expect(log.attributes[ATTR_WORKFLOW_ID]).toBe("wf-1");
		expect(log.attributes[ATTR_WORKFLOW_STATE]).toBe("Draft");
		expect(log.attributes[ATTR_RESULT]).toBe("ok");
		expect(log.attributes[ATTR_DISPATCH_DURATION_MS]).toBeTypeOf("number");
		expect(log.attributes[ATTR_DISPATCH_DURATION_MS] as number).toBeGreaterThanOrEqual(0);
	});
});
