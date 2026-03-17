import type { ExecutionEngine, ExecutionResult } from "@rytejs/core/engine";
import { describe, expect, test, vi } from "vitest";
import { createBroadcaster } from "../src/server/broadcaster.js";

function createMockEngine(overrides: Partial<ExecutionEngine> = {}) {
	return {
		load: vi.fn(),
		create: vi.fn(),
		execute: vi.fn(),
		getRouter: vi.fn(),
		...overrides,
	} as unknown as ExecutionEngine;
}

describe("createBroadcaster", () => {
	test("execute delegates to engine and returns result", async () => {
		const execResult: ExecutionResult = {
			result: { ok: true, workflow: {} as never, events: [] },
			events: [],
			version: 2,
		};
		const engine = createMockEngine({
			execute: vi.fn().mockResolvedValue(execResult),
			getRouter: vi.fn().mockReturnValue({
				definition: { snapshot: vi.fn().mockReturnValue({}) },
			}),
		});

		const broadcaster = createBroadcaster({ engine });
		const result = await broadcaster.execute("orders", "wf-1", {
			type: "Submit",
			payload: {},
		});

		expect(engine.execute).toHaveBeenCalledWith("orders", "wf-1", {
			type: "Submit",
			payload: {},
		});
		expect(result).toBe(execResult);
	});

	test("subscribe returns SSE response with correct headers", async () => {
		const snapshot = {
			id: "wf-1",
			definitionName: "orders",
			state: "Draft",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("Connection")).toBe("keep-alive");
	});

	test("subscribe sends initial snapshot as first SSE message", async () => {
		const snapshot = {
			id: "wf-1",
			definitionName: "orders",
			state: "Draft",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");

		const reader = response.body!.getReader();
		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);

		expect(text).toContain(`data: ${JSON.stringify({ snapshot, version: 1 })}`);
		reader.cancel();
	});

	test("execute broadcasts to subscribed clients", async () => {
		const snapshot1 = {
			id: "wf-1",
			definitionName: "orders",
			state: "Draft",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		const snapshot2 = { ...snapshot1, state: "Placed" };

		const router = {
			definition: { snapshot: vi.fn().mockReturnValue(snapshot2) },
		};
		const execResult: ExecutionResult = {
			result: { ok: true, workflow: {} as never, events: [] },
			events: [],
			version: 2,
		};

		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot: snapshot1, version: 1 }),
			execute: vi.fn().mockResolvedValue(execResult),
			getRouter: vi.fn().mockReturnValue(router),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");
		const reader = response.body!.getReader();

		// Read initial snapshot
		await reader.read();

		// Execute a command — should broadcast
		await broadcaster.execute("orders", "wf-1", { type: "Place", payload: {} });

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain(`data: ${JSON.stringify({ snapshot: snapshot2, version: 2 })}`);
		reader.cancel();
	});

	test("connectionCount returns number of active subscribers", async () => {
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot: {}, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(0);

		const response = await broadcaster.subscribe("orders", "wf-1");
		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(1);

		// Cancel the stream to simulate disconnect
		await response.body!.cancel();

		// Give the cancel time to propagate
		await new Promise((r) => setTimeout(r, 10));
		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(0);
	});

	test("close cancels all connections", async () => {
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot: {}, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		await broadcaster.subscribe("orders", "wf-1");
		await broadcaster.subscribe("orders", "wf-2");

		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(1);
		expect(broadcaster.connectionCount("orders", "wf-2")).toBe(1);

		broadcaster.close();

		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(0);
		expect(broadcaster.connectionCount("orders", "wf-2")).toBe(0);
	});

	test("failed execute does not broadcast", async () => {
		const snapshot = {
			id: "wf-1",
			definitionName: "orders",
			state: "Draft",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		const execResult: ExecutionResult = {
			result: {
				ok: false,
				error: {
					category: "validation",
					source: "command",
					issues: [],
					message: "bad",
				},
			} as never,
			events: [],
			version: 1,
		};

		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot, version: 1 }),
			execute: vi.fn().mockResolvedValue(execResult),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");
		const reader = response.body!.getReader();

		// Read initial snapshot
		await reader.read();

		// Execute a failing command
		await broadcaster.execute("orders", "wf-1", { type: "Bad", payload: {} });

		// No more data should be available (non-blocking check)
		const readPromise = reader.read();
		const timeout = new Promise((r) => setTimeout(() => r("timeout"), 50));
		const result = await Promise.race([readPromise, timeout]);

		expect(result).toBe("timeout");
		reader.cancel();
	});
});
