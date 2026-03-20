import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { beforeEach, describe, expect, test } from "vitest";
import { createOtelExecutorPlugin } from "../executor.js";

// Setup in-memory tracing
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();

describe("createOtelExecutorPlugin", () => {
	beforeEach(() => {
		exporter.reset();
	});

	test("creates a branded executor plugin", () => {
		const plugin = createOtelExecutorPlugin();
		expect(typeof plugin).toBe("function");
	});

	test("registers execute:start and execute:end hooks", () => {
		const plugin = createOtelExecutorPlugin();

		const onCalls: string[] = [];
		const fakeExecutor = {
			on(event: string, _cb: unknown) {
				onCalls.push(event);
				return fakeExecutor;
			},
			use(_mw: unknown) {
				return fakeExecutor;
			},
		};

		plugin(fakeExecutor as never);

		expect(onCalls).toContain("execute:start");
		expect(onCalls).toContain("execute:end");
	});
});
