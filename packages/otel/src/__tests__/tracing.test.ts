import { SpanStatusCode } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_ERROR_DEPENDENCY,
	ATTR_ERROR_MESSAGE,
	ATTR_ERROR_SOURCE,
	ATTR_EVENT_TYPE,
	ATTR_TRANSITION_FROM,
	ATTR_TRANSITION_TO,
	ATTR_WORKFLOW_DEFINITION,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
} from "../conventions.js";
import { createOtelPlugin } from "../plugin.js";

const definition = defineWorkflow("order", {
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

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
	exporter = new InMemorySpanExporter();
	provider = new NodeTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
});

afterEach(async () => {
	await provider.shutdown();
});

describe("tracing plugin", () => {
	test("successful dispatch creates span with correct name and OK status", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
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

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0]!;
		expect(span.name).toBe("ryte.dispatch.Place");
		expect(span.status.code).toBe(SpanStatusCode.OK);
		expect(span.attributes[ATTR_WORKFLOW_ID]).toBe("wf-1");
		expect(span.attributes[ATTR_WORKFLOW_STATE]).toBe("Draft");
		expect(span.attributes[ATTR_WORKFLOW_DEFINITION]).toBe("order");
		expect(span.attributes[ATTR_COMMAND_TYPE]).toBe("Place");
	});

	test("transition adds span event with from/to attributes", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
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

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const transitionEvents = spans[0]!.events.filter((e) => e.name === "ryte.transition");
		expect(transitionEvents).toHaveLength(1);
		expect(transitionEvents[0]!.attributes?.[ATTR_TRANSITION_FROM]).toBe("Draft");
		expect(transitionEvents[0]!.attributes?.[ATTR_TRANSITION_TO]).toBe("Placed");
	});

	test("domain event adds span event with type attribute", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command, emit, workflow }) => {
				transition("Placed", { total: command.payload.total });
				emit({ type: "OrderPlaced", data: { orderId: workflow.id } });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const domainEvents = spans[0]!.events.filter((e) => e.name === "ryte.event");
		expect(domainEvents).toHaveLength(1);
		expect(domainEvents[0]!.attributes?.[ATTR_EVENT_TYPE]).toBe("OrderPlaced");
	});

	test("domain error sets ERROR status and error attributes", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
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

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("domain");
		expect(span.attributes[ATTR_ERROR_CODE]).toBe("OutOfStock");
	});

	test("unexpected error sets ERROR status with category and message", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
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
		if (!result.ok) expect(result.error.category).toBe("unexpected");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.status.message).toBe("something went wrong");
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("unexpected");
		expect(span.attributes[ATTR_ERROR_MESSAGE]).toBe("something went wrong");
	});

	test("validation error sets ERROR status with category and source", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid payload
		const result = await router.dispatch(wf, { type: "Place", payload: {} as any });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.category).toBe("validation");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("validation");
		expect(span.attributes[ATTR_ERROR_SOURCE]).toBe("command");
	});

	test("dependency error sets ERROR status with category and dependency name", async () => {
		const tracer = provider.getTracer("test");
		const deps = {
			db: {
				save: () => {
					throw new Error("down");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.use(createOtelPlugin({ tracer }));
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
		if (!result.ok) expect(result.error.category).toBe("dependency");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("dependency");
		expect(span.attributes[ATTR_ERROR_DEPENDENCY]).toBe("db");
	});

	test("router error (NO_HANDLER) creates span with ERROR status", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
		// No handlers registered — dispatch will return NO_HANDLER

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("router");
			if (result.error.category === "router") {
				expect(result.error.code).toBe("NO_HANDLER");
			}
		}

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("router");
		expect(span.attributes[ATTR_ERROR_CODE]).toBe("NO_HANDLER");
	});

	test("span ends even when handler throws", async () => {
		const tracer = provider.getTracer("test");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer }));
		router.state("Draft", ({ on }) => {
			on("Place", () => {
				throw new Error("kaboom");
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 100 } });

		expect(result.ok).toBe(false);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		// The span was ended (it appears in finished spans)
		expect(spans[0]!.status.code).toBe(SpanStatusCode.ERROR);
	});
});
