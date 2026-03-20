import type { BroadcastMessage } from "@rytejs/core/transport";
import { describe, expect, test, vi } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter, definition } from "./helpers.js";

describe("transport store", () => {
	test("dispatch goes through transport when provided", async () => {
		const router = createTestRouter();
		const dispatchFn = vi.fn(async () => ({
			ok: true as const,
			snapshot: definition.snapshot(
				definition.createWorkflow("todo-1", {
					initialState: "InProgress",
					data: { title: "Test", assignee: "Alice" },
				}),
			),
			version: 2,
			events: [],
		}));

		const transport = {
			dispatch: dispatchFn,
			subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
		};

		const store = createWorkflowStore(
			router,
			{
				state: "Pending",
				data: { title: "Test" },
				id: "todo-1",
			},
			{ transport },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		expect(dispatchFn).toHaveBeenCalledWith(
			"todo-1",
			{ type: "Start", payload: { assignee: "Alice" } },
			expect.any(Number),
		);
	});

	test("transport dispatch updates workflow from server snapshot", async () => {
		const router = createTestRouter();
		const serverWorkflow = definition.createWorkflow("todo-1", {
			initialState: "InProgress",
			data: { title: "Test", assignee: "Alice" },
		});
		const transport = {
			dispatch: vi.fn(async () => ({
				ok: true as const,
				snapshot: definition.snapshot(serverWorkflow),
				version: 2,
				events: [],
			})),
			subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
		};

		const store = createWorkflowStore(
			router,
			{
				state: "Pending",
				data: { title: "Test" },
				id: "todo-1",
			},
			{ transport },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		expect(store.getWorkflow().state).toBe("InProgress");
	});

	test("subscribes to transport on creation", () => {
		const router = createTestRouter();
		const subscribeFn = vi.fn(() => ({ unsubscribe: vi.fn() }));

		const transport = {
			dispatch: vi.fn(async () => ({
				ok: true as const,
				snapshot: {} as never,
				version: 1,
				events: [],
			})),
			subscribe: subscribeFn,
		};

		createWorkflowStore(
			router,
			{
				state: "Pending",
				data: { title: "Test" },
				id: "todo-1",
			},
			{ transport },
		);

		expect(subscribeFn).toHaveBeenCalledWith("todo-1", expect.any(Function));
	});

	test("cleanup unsubscribes from transport", () => {
		const router = createTestRouter();
		const unsubscribe = vi.fn();
		const transport = {
			dispatch: vi.fn(async () => ({
				ok: true as const,
				snapshot: {} as never,
				version: 1,
				events: [],
			})),
			subscribe: vi.fn(() => ({ unsubscribe })),
		};

		const store = createWorkflowStore(
			router,
			{
				state: "Pending",
				data: { title: "Test" },
				id: "todo-1",
			},
			{ transport },
		);

		store.cleanup();
		expect(unsubscribe).toHaveBeenCalled();
	});

	test("incoming broadcast updates workflow", () => {
		const router = createTestRouter();
		let broadcastCallback: ((msg: BroadcastMessage) => void) | null = null;

		const transport = {
			dispatch: vi.fn(async () => ({
				ok: true as const,
				snapshot: {} as never,
				version: 1,
				events: [],
			})),
			subscribe: vi.fn((_id: string, cb: (msg: BroadcastMessage) => void) => {
				broadcastCallback = cb;
				return { unsubscribe: vi.fn() };
			}),
		};

		const store = createWorkflowStore(
			router,
			{
				state: "Pending",
				data: { title: "Test" },
				id: "todo-1",
			},
			{ transport },
		);

		expect(broadcastCallback).not.toBeNull();

		// Simulate incoming broadcast
		const newWorkflow = definition.createWorkflow("todo-1", {
			initialState: "InProgress",
			data: { title: "Test", assignee: "Bob" },
		});
		broadcastCallback!({
			snapshot: definition.snapshot(newWorkflow),
			version: 3,
			events: [],
		});

		expect(store.getWorkflow().state).toBe("InProgress");
	});

	test("without transport, dispatch works locally", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });
		expect(result.ok).toBe(true);
	});

	test("transport requires id", () => {
		const router = createTestRouter();
		const transport = {
			dispatch: vi.fn(async () => ({
				ok: true as const,
				snapshot: {} as never,
				version: 1,
				events: [],
			})),
			subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
		};

		expect(() =>
			createWorkflowStore(
				router,
				{
					state: "Pending",
					data: { title: "Test" },
					// no id
				},
				{ transport },
			),
		).toThrow();
	});
});
