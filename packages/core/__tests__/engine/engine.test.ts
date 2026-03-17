import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { createEngine, ExecutionEngine } from "../../src/engine/engine.js";
import {
	ConcurrencyConflictError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "../../src/engine/errors.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import type { StoreAdapter } from "../../src/engine/types.js";
import { WorkflowRouter } from "../../src/router.js";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Complete: z.object({}),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		AlreadyDone: z.object({}),
	},
});

const taskRouter = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", { title: data.title, completedAt: new Date() });
			emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
		});
	})
	.state("Done", ({ on }) => {
		on("Complete", ({ error }) => {
			error({ code: "AlreadyDone", data: {} });
		});
	});

function makeEngine(storeOverride?: StoreAdapter) {
	const store = storeOverride ?? memoryStore();
	return createEngine({
		store,
		routers: { task: taskRouter },
	});
}

describe("ExecutionEngine", () => {
	describe("getRouter()", () => {
		test("returns registered router", () => {
			const engine = makeEngine();
			expect(engine.getRouter("task")).toBe(taskRouter);
		});

		test("throws RouterNotFoundError for unknown name", () => {
			const engine = makeEngine();
			expect(() => engine.getRouter("unknown")).toThrow(RouterNotFoundError);
		});
	});

	describe("load()", () => {
		test("returns stored workflow after create", async () => {
			const engine = makeEngine();
			await engine.create("task", "task-1", { initialState: "Todo", data: { title: "Test" } });

			const stored = await engine.load("task-1");
			expect(stored).not.toBeNull();
			expect(stored!.snapshot.id).toBe("task-1");
			expect(stored!.snapshot.state).toBe("Todo");
			expect(stored!.snapshot.data).toEqual({ title: "Test" });
			expect(stored!.version).toBe(1);
		});

		test("returns null for unknown ID", async () => {
			const engine = makeEngine();
			expect(await engine.load("nonexistent")).toBeNull();
		});
	});

	describe("create()", () => {
		test("creates workflow and persists", async () => {
			const engine = makeEngine();
			const result = await engine.create("task", "task-1", {
				initialState: "Todo",
				data: { title: "Write tests" },
			});

			expect(result.version).toBe(1);
			expect(result.workflow.id).toBe("task-1");
			expect(result.workflow.definitionName).toBe("task");
			expect(result.workflow.state).toBe("Todo");
			expect(result.workflow.data).toEqual({ title: "Write tests" });

			const stored = await engine.load("task-1");
			expect(stored).not.toBeNull();
			expect(stored!.snapshot).toEqual(result.workflow);
		});

		test("throws WorkflowAlreadyExistsError for duplicate", async () => {
			const engine = makeEngine();
			await engine.create("task", "task-1", {
				initialState: "Todo",
				data: { title: "First" },
			});

			await expect(
				engine.create("task", "task-1", {
					initialState: "Todo",
					data: { title: "Duplicate" },
				}),
			).rejects.toThrow(WorkflowAlreadyExistsError);
		});

		test("throws RouterNotFoundError for unknown router", async () => {
			const engine = makeEngine();

			await expect(
				engine.create("unknown", "task-1", {
					initialState: "Todo",
					data: { title: "Test" },
				}),
			).rejects.toThrow(RouterNotFoundError);
		});
	});

	describe("execute()", () => {
		test("dispatches and persists", async () => {
			const engine = makeEngine();
			await engine.create("task", "task-1", {
				initialState: "Todo",
				data: { title: "Ship it" },
			});

			const execResult = await engine.execute("task", "task-1", {
				type: "Complete",
				payload: {},
			});

			expect(execResult.result.ok).toBe(true);
			expect(execResult.version).toBe(2);
			expect(execResult.events).toHaveLength(1);
			expect(execResult.events[0]).toEqual({
				type: "TaskCompleted",
				data: { taskId: "task-1" },
			});

			const stored = await engine.load("task-1");
			expect(stored!.snapshot.state).toBe("Done");
			expect(stored!.version).toBe(2);
		});

		test("does not persist on failed dispatch and returns current version", async () => {
			const engine = makeEngine();
			await engine.create("task", "task-1", {
				initialState: "Done",
				data: { title: "Already done", completedAt: new Date() },
			});

			const execResult = await engine.execute("task", "task-1", {
				type: "Complete",
				payload: {},
			});

			expect(execResult.result.ok).toBe(false);
			expect(execResult.version).toBe(1);
			expect(execResult.events).toEqual([]);

			// Version should not have changed in the store
			const stored = await engine.load("task-1");
			expect(stored!.version).toBe(1);
		});

		test("returns domain error with correct category", async () => {
			const engine = makeEngine();
			await engine.create("task", "task-1", {
				initialState: "Done",
				data: { title: "Done task", completedAt: new Date() },
			});

			const execResult = await engine.execute("task", "task-1", {
				type: "Complete",
				payload: {},
			});

			expect(execResult.result.ok).toBe(false);
			if (!execResult.result.ok) {
				expect(execResult.result.error.category).toBe("domain");
				if (execResult.result.error.category === "domain") {
					expect(execResult.result.error.code).toBe("AlreadyDone");
				}
			}
		});

		test("throws WorkflowNotFoundError for missing workflow", async () => {
			const engine = makeEngine();

			await expect(
				engine.execute("task", "nonexistent", {
					type: "Complete",
					payload: {},
				}),
			).rejects.toThrow(WorkflowNotFoundError);
		});

		test("throws RouterNotFoundError for unknown router", async () => {
			const engine = makeEngine();

			await expect(
				engine.execute("unknown", "task-1", {
					type: "Complete",
					payload: {},
				}),
			).rejects.toThrow(RouterNotFoundError);
		});

		test("throws ConcurrencyConflictError on version mismatch", async () => {
			const conflictStore: StoreAdapter = {
				async load() {
					return {
						snapshot: {
							id: "task-1",
							definitionName: "task",
							state: "Todo",
							data: { title: "Test" },
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							modelVersion: 1,
						},
						version: 1,
					};
				},
				async save() {
					throw new ConcurrencyConflictError("task-1", 1, 2);
				},
			};

			const engine = makeEngine(conflictStore);

			await expect(
				engine.execute("task", "task-1", {
					type: "Complete",
					payload: {},
				}),
			).rejects.toThrow(ConcurrencyConflictError);
		});
	});
});
