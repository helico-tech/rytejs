import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// Docs-only workflow definition covering all states and commands used on this page.
const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), priority: z.number().optional() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
		Rename: z.object({ title: z.string() }),
	},
	events: {
		TaskStarted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotAllowed: z.object({}),
	},
});

const router = new WorkflowRouter(taskWorkflow);

// #region read-data
router.state("Todo", ({ on }) => {
	on("Rename", ({ data }) => {
		console.log(data.title); // current title
	});
});
// #endregion read-data

// #region update
router.state("Todo", ({ on }) => {
	on("Rename", ({ command, update }) => {
		update({ title: command.payload.title });
		// State is still "Todo", data.title is updated
	});
});
// #endregion update

// #region transition
router.state("Todo", ({ on }) => {
	on("Start", ({ data, command, transition }) => {
		transition("InProgress", {
			title: data.title,
			assignee: command.payload.assignee,
		});
	});
});
// #endregion transition

// Separate router for rollback to avoid handler conflicts with #transition above
const rollbackRouter = new WorkflowRouter(taskWorkflow);

// #region rollback
rollbackRouter.state("Todo", ({ on }) => {
	on("Start", ({ update, error }) => {
		update({ title: "Modified" }); // provisional
		error({ code: "NotAllowed", data: {} }); // throws -- update is discarded
	});
});

const task = taskWorkflow.createWorkflow("task-1", {
	initialState: "Todo",
	data: { title: "Write docs" },
});

(async () => {
	const result = await rollbackRouter.dispatch(task, { type: "Start", payload: { assignee: "x" } });
	// result.ok === false
	// task.data.title is still the original value
	void result;
})();
// #endregion rollback
