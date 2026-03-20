import { describe, expect, test, vi } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { memoryStore } from "../../src/store/memory-store.js";
import type { StoreAdapter } from "../../src/store/types.js";
import { createTestRouter } from "./helpers.js";

describe("withStore", () => {
	test("create saves snapshot with version 1", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		const result = await executor.create("order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.version).toBe(1);

		const stored = await store.load("order-1");
		expect(stored).not.toBeNull();
		expect(stored?.version).toBe(1);
		expect(stored?.snapshot.state).toBe("Draft");
	});

	test("execute loads, dispatches, and saves", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["widget"] } });

		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.version).toBe(2);
		expect(result.snapshot.state).toBe("Placed");

		const stored = await store.load("order-1");
		expect(stored?.version).toBe(2);
	});

	test("execute returns not_found for missing workflow", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		const result = await executor.execute("missing", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("not_found");
	});

	test("create returns already_exists for duplicate id", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		const result = await executor.create("order-1", {
			initialState: "Draft",
			data: { items: [] },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("already_exists");
	});

	test("concurrent writes return conflict", async () => {
		const store = memoryStore();

		// Two executors sharing the same store — both load version 1
		const exec1 = new WorkflowExecutor(createTestRouter());
		exec1.use(withStore(store));
		const exec2 = new WorkflowExecutor(createTestRouter());
		exec2.use(withStore(store));

		await exec1.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const [r1, r2] = await Promise.all([
			exec1.execute("order-1", { type: "AddItem", payload: { item: "b" } }),
			exec2.execute("order-1", { type: "AddItem", payload: { item: "c" } }),
		]);

		// One succeeds, one conflicts
		const results = [r1, r2];
		const successes = results.filter((r) => r.ok);
		const conflicts = results.filter((r) => !r.ok);
		expect(successes).toHaveLength(1);
		expect(conflicts).toHaveLength(1);
		if (!conflicts[0].ok) {
			expect(conflicts[0].error.category).toBe("conflict");
		}
	});

	test("failed dispatch does not save", async () => {
		const store = memoryStore();
		const saveSpy = vi.spyOn(store, "save");
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		saveSpy.mockClear();

		// Place on empty items → domain error
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		expect(saveSpy).not.toHaveBeenCalled();
	});

	test("events are passed to store.save", async () => {
		const saved: Array<{ events?: Array<{ type: string; data: unknown }> }> = [];

		// Use a real memoryStore that also tracks events
		const realStore = memoryStore();
		const trackingStore: StoreAdapter = {
			async load(id) {
				return realStore.load(id);
			},
			async save(options) {
				saved.push({ events: options.events });
				await realStore.save(options);
			},
		};

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(trackingStore));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		// Create save has no events
		expect(saved[0].events).toEqual([]);
		// Execute save has OrderPlaced event
		expect(saved[1].events).toHaveLength(1);
		expect(saved[1].events?.[0].type).toBe("OrderPlaced");
	});

	test("expectedVersion mismatch returns conflict without dispatching", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		// Manually create context with wrong expectedVersion
		// Use a wrapper middleware to set expectedVersion
		const exec2 = new WorkflowExecutor(createTestRouter());
		exec2.use(async (ctx, next) => {
			(ctx as { expectedVersion?: number }).expectedVersion = 99;
			await next();
		});
		exec2.use(withStore(store));

		const result = await exec2.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("conflict");
	});
});
