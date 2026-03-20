import { SpanStatusCode } from "@opentelemetry/api";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { ExecutorContext } from "@rytejs/core/executor";
import { beforeEach, describe, expect, test } from "vitest";
import { createOtelExecutorMiddleware } from "../executor.js";

// Setup in-memory tracing
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
	return {
		id: "test-1",
		command: { type: "Place", payload: {} },
		stored: {
			snapshot: {
				id: "test-1",
				definitionName: "order",
				state: "Draft",
				data: {},
				createdAt: "",
				updatedAt: "",
				modelVersion: 1,
			},
			version: 1,
		},
		result: null,
		snapshot: null,
		events: [],
		...overrides,
	};
}

describe("createOtelExecutorMiddleware", () => {
	beforeEach(() => {
		exporter.reset();
	});

	test("returns a middleware function", () => {
		const mw = createOtelExecutorMiddleware();
		expect(typeof mw).toBe("function");
	});

	test("creates span with correct name and attributes", async () => {
		const mw = createOtelExecutorMiddleware();
		const ctx = makeCtx();

		await mw(ctx, async () => {
			ctx.snapshot = ctx.stored.snapshot;
		});

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		const span = spans[0]!;
		expect(span.name).toBe("ryte.execute.Place");
		expect(span.attributes["ryte.workflow.id"]).toBe("test-1");
		expect(span.attributes["ryte.command.type"]).toBe("Place");
	});

	test("sets OK status on success", async () => {
		const mw = createOtelExecutorMiddleware();
		const ctx = makeCtx();

		await mw(ctx, async () => {
			ctx.snapshot = ctx.stored.snapshot;
		});

		const spans = exporter.getFinishedSpans();
		const span = spans[0]!;
		expect(span.attributes["ryte.result"]).toBe("ok");
		expect(span.status.code).toBe(SpanStatusCode.OK);
	});

	test("sets ERROR status on dispatch error", async () => {
		const mw = createOtelExecutorMiddleware();
		const ctx = makeCtx();

		await mw(ctx, async () => {
			ctx.result = {
				ok: false as const,
				error: { category: "domain" as const, code: "EmptyCart", data: {} },
			};
		});

		const spans = exporter.getFinishedSpans();
		const span = spans[0]!;
		expect(span.attributes["ryte.result"]).toBe("error");
		expect(span.attributes["ryte.error.category"]).toBe("domain");
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
	});

	test("re-throws errors after recording on span", async () => {
		const mw = createOtelExecutorMiddleware();
		const ctx = makeCtx();

		await expect(
			mw(ctx, async () => {
				throw new Error("kaboom");
			}),
		).rejects.toThrow("kaboom");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		const span = spans[0]!;
		expect(span.attributes["ryte.result"]).toBe("error");
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
	});

	test("accepts custom tracer name", async () => {
		const mw = createOtelExecutorMiddleware({ tracerName: "custom-tracer" });
		const ctx = makeCtx();

		await mw(ctx, async () => {
			ctx.snapshot = ctx.stored.snapshot;
		});

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		const span = spans[0]!;
		expect(span.instrumentationLibrary.name).toBe("custom-tracer");
	});
});
