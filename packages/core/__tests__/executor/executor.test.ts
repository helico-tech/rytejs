import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import type { ExecutorContext } from "../../src/executor/types.js";
import type { WorkflowSnapshot } from "../../src/snapshot.js";
import { memoryStore } from "../../src/store/memory-store.js";
import { createTestRouter, definition } from "./helpers.js";

function seed(store: ReturnType<typeof memoryStore>, id: string, data: { items: string[] }) {
	const workflow = definition.createWorkflow(id, {
		initialState: "Draft",
		data,
	});
	const snapshot = definition.serialize(workflow) as WorkflowSnapshot;
	return store.save({ id, snapshot, expectedVersion: 0 });
}

describe("WorkflowExecutor", () => {
	describe("execute", () => {
		test("loads, dispatches, and saves", async () => {
			const store = memoryStore();
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router, store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.snapshot.state).toBe("Placed");
			expect(result.version).toBe(2);
			expect(result.events).toHaveLength(1);
			expect(result.events[0].type).toBe("OrderPlaced");
		});

		test("returns not_found when workflow does not exist", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			const result = await executor.execute("nonexistent", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("not_found");
		});

		test("returns domain error from handler", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: [] });

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("domain");
		});

		test("returns validation error for unknown command", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute("order-1", {
				type: "NonExistent",
				payload: {},
			});

			expect(result.ok).toBe(false);
		});
	});

	describe("expectedVersion", () => {
		test("succeeds when expectedVersion matches stored version", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute(
				"order-1",
				{ type: "AddItem", payload: { item: "gadget" } },
				{ expectedVersion: 1 },
			);

			expect(result.ok).toBe(true);
		});

		test("returns conflict when expectedVersion does not match", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute(
				"order-1",
				{ type: "AddItem", payload: { item: "gadget" } },
				{ expectedVersion: 99 },
			);

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("conflict");
			if (result.error.category !== "conflict") return;
			expect(result.error.expectedVersion).toBe(99);
			expect(result.error.actualVersion).toBe(1);
		});
	});

	describe("concurrency", () => {
		test("one write succeeds, concurrent write gets conflict", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["a"] });

			const [r1, r2] = await Promise.all([
				executor.execute("order-1", { type: "AddItem", payload: { item: "b" } }),
				executor.execute("order-1", { type: "AddItem", payload: { item: "c" } }),
			]);

			const successes = [r1, r2].filter((r) => r.ok);
			const failures = [r1, r2].filter((r) => !r.ok);
			expect(successes).toHaveLength(1);
			expect(failures).toHaveLength(1);
		});
	});

	describe("middleware", () => {
		test("executes in onion order", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);
			const order: string[] = [];

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (_ctx, next) => {
				order.push("A:before");
				await next();
				order.push("A:after");
			});
			executor.use(async (_ctx, next) => {
				order.push("B:before");
				await next();
				order.push("B:after");
			});

			await executor.execute("order-1", { type: "AddItem", payload: { item: "x" } });

			expect(order).toEqual(["A:before", "B:before", "B:after", "A:after"]);
		});

		test("middleware sees stored workflow on context", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);
			let captured: ExecutorContext | null = null;

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (ctx, next) => {
				captured = ctx;
				await next();
			});

			await executor.execute("order-1", { type: "AddItem", payload: { item: "x" } });

			expect(captured).not.toBeNull();
			expect(captured!.stored.snapshot.state).toBe("Draft");
			expect(captured!.stored.version).toBe(1);
		});

		test("middleware can short-circuit by not calling next", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (ctx, _next) => {
				ctx.result = {
					ok: false as const,
					error: { category: "not_found" as const, id: ctx.id },
				};
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			// Verify nothing was saved (version unchanged)
			const loaded = await store.load("order-1");
			expect(loaded!.version).toBe(1);
		});

		test("use() returns this for chaining", () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			const returned = executor.use(async (_ctx, next) => {
				await next();
			});
			expect(returned).toBe(executor);
		});
	});

	describe("error boundary", () => {
		test("catches unexpected middleware errors", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async () => {
				throw new Error("kaboom");
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("unexpected");
		});

		test("execute never throws", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async () => {
				throw new Error("kaboom");
			});

			// Should not throw — returns error result
			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		test("does not save when middleware throws", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (_ctx, next) => {
				await next();
				throw new Error("post-dispatch error");
			});

			await executor.execute("order-1", { type: "AddItem", payload: { item: "x" } });

			// Version should be unchanged — error prevented save
			const loaded = await store.load("order-1");
			expect(loaded!.version).toBe(1);
		});
	});
});
