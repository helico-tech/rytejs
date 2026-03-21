import {
	AggregationTemporality,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
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
	ATTR_RESULT,
	ATTR_TRANSITION_FROM,
	ATTR_TRANSITION_TO,
	ATTR_WORKFLOW_STATE,
	METRIC_DISPATCH_COUNT,
	METRIC_DISPATCH_DURATION,
	METRIC_TRANSITION_COUNT,
} from "../conventions.js";
import { createOtelPlugin } from "../plugin.js";

const definition = defineWorkflow("metrics-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
	},
	events: {
		Published: z.object({ id: z.string() }),
	},
	errors: {
		TitleRequired: z.object({}),
	},
});

// biome-ignore lint/suspicious/noExplicitAny: test helper inspects opaque metric structures
function findMetric(name: string, resourceMetrics: any[]) {
	for (const rm of resourceMetrics) {
		for (const sm of rm.scopeMetrics) {
			for (const m of sm.metrics) {
				if (m.descriptor.name === name) return m;
			}
		}
	}
	return undefined;
}

describe("otel metrics", () => {
	let metricExporter: InMemoryMetricExporter;
	let meterProvider: MeterProvider;
	let metricReader: PeriodicExportingMetricReader;
	let spanExporter: InMemorySpanExporter;
	let tracerProvider: NodeTracerProvider;

	beforeEach(() => {
		metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
		metricReader = new PeriodicExportingMetricReader({
			exporter: metricExporter,
			exportIntervalMillis: 100,
		});
		meterProvider = new MeterProvider({ readers: [metricReader] });

		spanExporter = new InMemorySpanExporter();
		tracerProvider = new NodeTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(spanExporter)],
		});
	});

	afterEach(async () => {
		await metricReader.shutdown();
		await meterProvider.shutdown();
		await tracerProvider.shutdown();
	});

	test("dispatch increments ryte.dispatch.count with correct attributes", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				meter: meterProvider.getMeter("ryte"),
			}),
		);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true);

		await metricReader.forceFlush();
		const collected = metricExporter.getMetrics();

		const counter = findMetric(METRIC_DISPATCH_COUNT, collected);
		expect(counter).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		expect(counter!.dataPoints.length).toBeGreaterThanOrEqual(1);

		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		const dp = counter!.dataPoints[0];
		expect(dp.attributes[ATTR_COMMAND_TYPE]).toBe("Publish");
		expect(dp.attributes[ATTR_WORKFLOW_STATE]).toBeDefined();
		expect(dp.attributes[ATTR_RESULT]).toBe("ok");
		expect(dp.value).toBe(1);
	});

	test("dispatch records ryte.dispatch.duration histogram", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				meter: meterProvider.getMeter("ryte"),
			}),
		);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });

		await metricReader.forceFlush();
		const collected = metricExporter.getMetrics();

		const histogram = findMetric(METRIC_DISPATCH_DURATION, collected);
		expect(histogram).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		expect(histogram!.descriptor.unit).toBe("ms");
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		expect(histogram!.dataPoints.length).toBeGreaterThanOrEqual(1);

		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		const dp = histogram!.dataPoints[0];
		expect(dp.attributes[ATTR_COMMAND_TYPE]).toBe("Publish");
		expect(dp.value.count).toBeGreaterThanOrEqual(1);
	});

	test("transition increments ryte.transition.count with from/to", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				meter: meterProvider.getMeter("ryte"),
			}),
		);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });

		await metricReader.forceFlush();
		const collected = metricExporter.getMetrics();

		const counter = findMetric(METRIC_TRANSITION_COUNT, collected);
		expect(counter).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		expect(counter!.dataPoints.length).toBeGreaterThanOrEqual(1);

		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		const dp = counter!.dataPoints[0];
		expect(dp.attributes[ATTR_TRANSITION_FROM]).toBe("Draft");
		expect(dp.attributes[ATTR_TRANSITION_TO]).toBe("Published");
		expect(dp.value).toBe(1);
	});

	test("error dispatch tags counter with error category", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				meter: meterProvider.getMeter("ryte"),
			}),
		);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.error({ code: "TitleRequired", data: {} });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(false);

		await metricReader.forceFlush();
		const collected = metricExporter.getMetrics();

		const counter = findMetric(METRIC_DISPATCH_COUNT, collected);
		expect(counter).toBeDefined();

		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		const dp = counter!.dataPoints[0];
		expect(dp.attributes[ATTR_RESULT]).toBe("error");
		expect(dp.attributes[ATTR_ERROR_CATEGORY]).toBe("domain");
	});

	test("early-return errors (no handler) are counted", async () => {
		const router = new WorkflowRouter(definition);
		router.use(
			createOtelPlugin({
				tracer: tracerProvider.getTracer("ryte"),
				meter: meterProvider.getMeter("ryte"),
			}),
		);
		// No handlers registered — dispatch should return a router error

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(false);

		await metricReader.forceFlush();
		const collected = metricExporter.getMetrics();

		const counter = findMetric(METRIC_DISPATCH_COUNT, collected);
		expect(counter).toBeDefined();

		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		const dp = counter!.dataPoints[0];
		expect(dp.attributes[ATTR_RESULT]).toBe("error");
		expect(dp.attributes[ATTR_ERROR_CATEGORY]).toBe("router");
	});
});
