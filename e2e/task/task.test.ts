import { createKey, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { taskWorkflow } from "./definition.ts";
import { router } from "./router.ts";

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
			.use(router);

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
