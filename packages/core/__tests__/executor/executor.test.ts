import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import type { ExecutorContext } from "../../src/executor/types.js";
import { createTestRouter, definition } from "./helpers.js";

describe("WorkflowExecutor", () => {
	describe("create", () => {
		test("creates a workflow and returns snapshot + version", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: ["widget"] },
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.snapshot.id).toBe("order-1");
			expect(result.snapshot.state).toBe("Draft");
			expect(result.version).toBe(0);
			expect(result.events).toEqual([]);
		});

		test("returns validation error for invalid initial state", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.create("order-1", {
				initialState: "NonExistent",
				data: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("validation");
		});

		test("returns validation error for invalid data", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: "not-an-array" },
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("validation");
		});
	});

	describe("execute", () => {
		test("dispatches command when stored workflow is on context", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const workflow = definition.createWorkflow("order-1", {
				initialState: "Draft",
				data: { items: ["widget"] },
			});
			executor.use(async (ctx, next) => {
				if (ctx.operation === "execute") {
					ctx.stored = {
						snapshot: definition.snapshot(workflow),
						version: 1,
					};
				}
				await next();
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.snapshot.state).toBe("Placed");
			expect(result.events).toHaveLength(1);
			expect(result.events[0].type).toBe("OrderPlaced");
		});

		test("returns error when no stored workflow on context", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("not_found");
		});
	});

	describe("error boundary", () => {
		test("catches unexpected middleware errors", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			executor.use(async () => {
				throw new Error("kaboom");
			});

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: [] },
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("unexpected");
		});

		test("execute never throws", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			executor.use(async () => {
				throw new Error("kaboom");
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});
			expect(result.ok).toBe(false);
		});
	});

	describe("hooks", () => {
		test("execute:start fires before pipeline", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			const order: string[] = [];

			executor.on("execute:start", () => {
				order.push("hook:start");
			});
			executor.use(async (_ctx, next) => {
				order.push("middleware");
				await next();
			});

			await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

			expect(order).toEqual(["hook:start", "middleware"]);
		});

		test("execute:end fires after pipeline", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			const order: string[] = [];

			executor.use(async (_ctx, next) => {
				order.push("middleware");
				await next();
			});
			executor.on("execute:end", () => {
				order.push("hook:end");
			});

			await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

			expect(order).toEqual(["middleware", "hook:end"]);
		});

		test("execute:end fires even on error", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			let endFired = false;

			executor.use(async () => {
				throw new Error("boom");
			});
			executor.on("execute:end", () => {
				endFired = true;
			});

			await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

			expect(endFired).toBe(true);
		});

		test("execute:end receives final context state", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			let capturedCtx: ExecutorContext | null = null;

			executor.on("execute:end", (ctx) => {
				capturedCtx = ctx;
			});

			await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

			expect(capturedCtx).not.toBeNull();
			expect(capturedCtx?.snapshot).not.toBeNull();
			expect(capturedCtx?.snapshot?.state).toBe("Draft");
		});
	});

	describe("middleware pipeline", () => {
		test("middleware executes in onion order", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			const order: string[] = [];

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

			await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

			expect(order).toEqual(["A:before", "B:before", "B:after", "A:after"]);
		});

		test("middleware can short-circuit by not calling next", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			executor.use(async (ctx, _next) => {
				ctx.result = { ok: false, error: { category: "not_found", id: ctx.id } } as never;
			});

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: [] },
			});

			expect(result.ok).toBe(false);
		});

		test("use() returns this for chaining", () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const returned = executor.use(async (_ctx, next) => {
				await next();
			});
			expect(returned).toBe(executor);
		});
	});
});
