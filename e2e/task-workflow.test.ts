import { createKey, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";

// ─── Define a workflow ───────────────────────────────────────────────

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		InProgress: z.object({
			title: z.string(),
			assignee: z.string(),
			startedAt: z.coerce.date(),
		}),
		Done: z.object({
			title: z.string(),
			assignee: z.string(),
			completedAt: z.coerce.date(),
		}),
	},
	commands: {
		Assign: z.object({ assignee: z.string() }),
		Start: z.object({}),
		Complete: z.object({}),
	},
	events: {
		TaskAssigned: z.object({ taskId: z.string(), assignee: z.string() }),
		TaskStarted: z.object({ taskId: z.string() }),
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotAssigned: z.object({}),
	},
});

// ─── Fluent router setup with composable routers ─────────────────────

const todoRouter = new WorkflowRouter(taskWorkflow).state("Todo", (state) => {
	state
		.on("Assign", (ctx) => {
			ctx.update({ assignee: ctx.command.payload.assignee });
			ctx.emit({
				type: "TaskAssigned",
				data: {
					taskId: ctx.workflow.id,
					assignee: ctx.command.payload.assignee,
				},
			});
		})
		.on("Start", (ctx) => {
			const { assignee } = ctx.data;
			if (!assignee) {
				ctx.error({ code: "NotAssigned", data: {} });
				return;
			}
			ctx.transition("InProgress", {
				title: ctx.data.title,
				assignee,
				startedAt: new Date(),
			});
			ctx.emit({ type: "TaskStarted", data: { taskId: ctx.workflow.id } });
		});
});

const inProgressRouter = new WorkflowRouter(taskWorkflow).state("InProgress", (state) => {
	state.on("Complete", (ctx) => {
		ctx.transition("Done", {
			title: ctx.data.title,
			assignee: ctx.data.assignee,
			completedAt: new Date(),
		});
		ctx.emit({
			type: "TaskCompleted",
			data: { taskId: ctx.workflow.id },
		});
	});
});

// Compose routers
const router = new WorkflowRouter(taskWorkflow).use(todoRouter).use(inProgressRouter);

// ─── Tests ──────────────────────────────────────────────────────────

describe("@rytejs/core E2E", () => {
	test("state transition: Todo → Todo (update)", async () => {
		const task = taskWorkflow.createWorkflow("task-1", {
			initialState: "Todo",
			data: { title: "Write docs" },
		});

		const result = await router.dispatch(task, {
			type: "Assign",
			payload: { assignee: "alice" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Todo");
		if (result.workflow.state === "Todo") {
			expect(result.workflow.data.assignee).toBe("alice");
		}
	});

	test("event emission", async () => {
		const task = taskWorkflow.createWorkflow("task-2", {
			initialState: "Todo",
			data: { title: "Ship it" },
		});

		const result = await router.dispatch(task, {
			type: "Assign",
			payload: { assignee: "bob" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("TaskAssigned");
	});

	test("domain error with rollback", async () => {
		const task = taskWorkflow.createWorkflow("task-3", {
			initialState: "Todo",
			data: { title: "No assignee" },
		});

		const result = await router.dispatch(task, {
			type: "Start",
			payload: {},
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("NotAssigned");
		}
		// Original workflow unchanged (rollback)
		expect(task.state).toBe("Todo");
	});

	test("full lifecycle: Todo → InProgress → Done", async () => {
		const task = taskWorkflow.createWorkflow("task-4", {
			initialState: "Todo",
			data: { title: "Full lifecycle", assignee: "alice" },
		});

		let result = await router.dispatch(task, {
			type: "Start",
			payload: {},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("InProgress");

		result = await router.dispatch(result.workflow, {
			type: "Complete",
			payload: {},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Done");
	});

	test("composable routers: handlers from child routers work", async () => {
		const task = taskWorkflow.createWorkflow("task-5", {
			initialState: "Todo",
			data: { title: "Composed" },
		});

		// Handler from todoRouter
		const r1 = await router.dispatch(task, {
			type: "Assign",
			payload: { assignee: "charlie" },
		});
		expect(r1.ok).toBe(true);

		// Handler from inProgressRouter
		const started = taskWorkflow.createWorkflow("task-6", {
			initialState: "InProgress",
			data: { title: "Started", assignee: "charlie", startedAt: new Date() },
		});
		const r2 = await router.dispatch(started, {
			type: "Complete",
			payload: {},
		});
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.workflow.state).toBe("Done");
	});

	test("context keys with middleware", async () => {
		const UserKey = createKey<string>("user");

		const authedRouter = new WorkflowRouter(taskWorkflow)
			.use(async (ctx, next) => {
				ctx.set(UserKey, "admin");
				await next();
			})
			.use(todoRouter);

		const task = taskWorkflow.createWorkflow("task-7", {
			initialState: "Todo",
			data: { title: "With middleware" },
		});

		const result = await authedRouter.dispatch(task, {
			type: "Assign",
			payload: { assignee: "dave" },
		});
		expect(result.ok).toBe(true);
	});
});
