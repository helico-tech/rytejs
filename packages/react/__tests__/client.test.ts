import { describe, expect, test, vi } from "vitest";
import { createWorkflowClient } from "../src/client.js";
import type { Transport } from "../src/transport.js";
import { definition } from "./helpers.js";

function createMockTransport(overrides?: Partial<Transport>): Transport {
	return {
		load: vi.fn(async () => ({
			snapshot: definition.serialize(
				definition.createWorkflow("test-1", {
					initialState: "Pending",
					data: { title: "Test" },
				}),
			),
			version: 1,
		})),
		dispatch: vi.fn(async () => ({
			ok: true as const,
			snapshot: definition.serialize(
				definition.createWorkflow("test-1", {
					initialState: "InProgress",
					data: { title: "Test", assignee: "Alice" },
				}),
			),
			version: 2,
			events: [{ type: "TodoStarted", data: { assignee: "Alice" } }],
		})),
		subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
		...overrides,
	};
}

describe("createWorkflowClient", () => {
	test("connect returns a WorkflowStore", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		expect(store).toHaveProperty("getSnapshot");
		expect(store).toHaveProperty("subscribe");
		expect(store).toHaveProperty("dispatch");
		expect(store).toHaveProperty("cleanup");
	});

	test("store starts in loading state", () => {
		const transport = createMockTransport({
			load: vi.fn(() => new Promise(() => {})),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");
		const snapshot = store.getSnapshot();

		expect(snapshot.isLoading).toBe(true);
		expect(snapshot.workflow).toBeNull();
	});

	test("loads initial state via transport.load()", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		expect(transport.load).toHaveBeenCalledWith("test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		const snapshot = store.getSnapshot();
		expect(snapshot.workflow).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeNull check above
		expect(snapshot.workflow!.state).toBe("Pending");
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeNull check above
		expect(snapshot.workflow!.data).toEqual({ title: "Test" });
	});

	test("load failure sets error", async () => {
		const transport = createMockTransport({
			load: vi.fn(async () => {
				throw new Error("Network error");
			}),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		const snapshot = store.getSnapshot();
		expect(snapshot.error).not.toBeNull();
		expect(snapshot.workflow).toBeNull();
	});

	test("load returns null (workflow not found)", async () => {
		const transport = createMockTransport({
			load: vi.fn(async () => null),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		const snapshot = store.getSnapshot();
		expect(snapshot.workflow).toBeNull();
		expect(snapshot.error).toBeNull();
	});

	test("dispatch calls transport.dispatch with version", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		await store.dispatch("Start", { assignee: "Alice" });

		expect(transport.dispatch).toHaveBeenCalledWith(
			"test-1",
			{ type: "Start", payload: { assignee: "Alice" } },
			1,
		);
	});

	test("dispatch updates workflow from server response", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: workflow is non-null after successful dispatch
		expect(store.getSnapshot().workflow!.state).toBe("InProgress");
		// biome-ignore lint/style/noNonNullAssertion: workflow is non-null after successful dispatch
		expect(store.getSnapshot().workflow!.data).toMatchObject({ assignee: "Alice" });
	});

	test("dispatch during loading rejects", async () => {
		const transport = createMockTransport({
			load: vi.fn(() => new Promise(() => {})),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("unexpected");
		}
	});

	test("subscribes to transport for live updates", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		client.connect(definition, "test-1");

		expect(transport.subscribe).toHaveBeenCalledWith("test-1", expect.any(Function));
	});

	test("broadcast updates workflow state", async () => {
		let broadcastCallback: ((message: unknown) => void) | undefined;
		const transport = createMockTransport({
			subscribe: vi.fn((_, callback) => {
				broadcastCallback = callback;
				return { unsubscribe: vi.fn() };
			}),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		expect(broadcastCallback).toBeDefined();

		const updatedWorkflow = definition.createWorkflow("test-1", {
			initialState: "InProgress",
			data: { title: "Test", assignee: "Bob" },
		});

		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		broadcastCallback!({
			snapshot: definition.serialize(updatedWorkflow),
			version: 3,
			events: [],
		});

		// biome-ignore lint/style/noNonNullAssertion: workflow is non-null after broadcast update
		expect(store.getSnapshot().workflow!.state).toBe("InProgress");
		// biome-ignore lint/style/noNonNullAssertion: workflow is non-null after broadcast update
		expect(store.getSnapshot().workflow!.data).toMatchObject({ assignee: "Bob" });
	});

	test("connect caches stores by definition + id", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store1 = client.connect(definition, "test-1");
		const store2 = client.connect(definition, "test-1");

		expect(store1).toBe(store2);
	});

	test("different ids return different stores", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store1 = client.connect(definition, "test-1");
		const store2 = client.connect(definition, "test-2");

		expect(store1).not.toBe(store2);
	});

	test("cleanup evicts store from cache so reconnect creates a fresh one", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store1 = client.connect(definition, "test-1");

		store1.cleanup();

		const store2 = client.connect(definition, "test-1");
		expect(store2).not.toBe(store1);

		// New store should load successfully
		await vi.waitFor(() => {
			expect(store2.getSnapshot().isLoading).toBe(false);
		});
		// biome-ignore lint/style/noNonNullAssertion: workflow is non-null after successful load
		expect(store2.getSnapshot().workflow!.state).toBe("Pending");
	});

	test("cleanup unsubscribes from transport", async () => {
		const unsubscribe = vi.fn();
		const transport = createMockTransport({
			subscribe: vi.fn(() => ({ unsubscribe })),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		store.cleanup();

		expect(unsubscribe).toHaveBeenCalled();
	});

	test("cleanup prevents load callback from updating state", async () => {
		let resolveLoad: ((value: unknown) => void) | undefined;
		const transport = createMockTransport({
			load: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveLoad = resolve;
					}),
			),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		const listener = vi.fn();
		store.subscribe(listener);

		// Cleanup before load resolves
		store.cleanup();
		listener.mockClear();

		// Now resolve the load
		// biome-ignore lint/style/noNonNullAssertion: resolveLoad is assigned in the Promise constructor above
		resolveLoad!({
			snapshot: definition.serialize(
				definition.createWorkflow("test-1", {
					initialState: "Pending",
					data: { title: "Test" },
				}),
			),
			version: 1,
		});

		// Wait a tick to ensure the promise callback runs
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Listener should NOT have been called — disposed store doesn't notify
		expect(listener).not.toHaveBeenCalled();
		expect(store.getSnapshot().workflow).toBeNull();
	});
});
