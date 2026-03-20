import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
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
});
