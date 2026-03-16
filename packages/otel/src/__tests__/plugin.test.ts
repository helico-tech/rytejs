import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { ATTR_WORKFLOW_ID } from "../conventions.js";
import { createOtelPlugin } from "../plugin.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({}),
		Placed: z.object({ total: z.number() }),
	},
	commands: {
		Place: z.object({ total: z.number() }),
	},
	events: {},
	errors: {},
});

describe("otel plugin integration", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new BasicTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		provider.register();
	});

	afterEach(async () => {
		await provider.shutdown();
	});

	test("zero-config works with global OTEL API", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: {},
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		expect(result.ok).toBe(true);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0]!.name).toBe("ryte.dispatch.Place");
	});

	test("custom tracer override is used", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer: provider.getTracer("custom-scope") }));
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: {},
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		expect(result.ok).toBe(true);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0]!.instrumentationLibrary.name).toBe("custom-scope");
	});

	test("multiple dispatches create independent spans", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer: provider.getTracer("ryte") }));
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf1 = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: {},
		});
		const wf2 = definition.createWorkflow("wf-2", {
			initialState: "Draft",
			data: {},
		});

		await router.dispatch(wf1, { type: "Place", payload: { total: 10 } });
		await router.dispatch(wf2, { type: "Place", payload: { total: 20 } });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(2);

		const ids = spans.map((s) => s.attributes[ATTR_WORKFLOW_ID]);
		expect(ids).toContain("wf-1");
		expect(ids).toContain("wf-2");

		// Spans should have different trace/span IDs
		expect(spans[0]!.spanContext().spanId).not.toBe(spans[1]!.spanContext().spanId);
	});

	test("no-op when no SDK is registered", async () => {
		// Shut down the provider so there's no active SDK
		await provider.shutdown();

		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", ({ transition, command }) => {
				transition("Placed", { total: command.payload.total });
			});
		});

		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: {},
		});
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		// Should not throw and should succeed
		expect(result.ok).toBe(true);
	});
});
