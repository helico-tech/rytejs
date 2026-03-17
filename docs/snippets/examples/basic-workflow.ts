import type { Workflow } from "@rytejs/core";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region define
const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), priority: z.number().default(0) }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
		Rename: z.object({ title: z.string() }),
	},
	events: {
		TaskStarted: z.object({ taskId: z.string(), assignee: z.string() }),
		TaskCompleted: z.object({ taskId: z.string() }),
		TaskRenamed: z.object({ taskId: z.string(), title: z.string() }),
	},
	errors: {},
});
// #endregion define

// #region router
const router = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Rename", ({ command, update, emit, workflow }) => {
			update({ title: command.payload.title });
			emit({
				type: "TaskRenamed",
				data: { taskId: workflow.id, title: command.payload.title },
			});
		});
		on("Start", ({ data, command, transition, emit, workflow }) => {
			transition("InProgress", {
				title: data.title,
				assignee: command.payload.assignee,
			});
			emit({
				type: "TaskStarted",
				data: { taskId: workflow.id, assignee: command.payload.assignee },
			});
		});
	})
	.state("InProgress", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", {
				title: data.title,
				completedAt: new Date(),
			});
			emit({
				type: "TaskCompleted",
				data: { taskId: workflow.id },
			});
		});
	});
// #endregion router

(async () => {
	// #region create
	// 1. Create a task
	let task: Workflow<typeof taskWorkflow.config> = taskWorkflow.createWorkflow("task-1", {
		initialState: "Todo",
		data: { title: "Write documentation", priority: 0 },
	});

	console.log(task.state); // "Todo"
	console.log(task.data.title); // "Write documentation"
	// #endregion create

	// #region rename
	let result = await router.dispatch(task, {
		type: "Rename",
		payload: { title: "Write complete documentation" },
	});

	if (result.ok) {
		task = result.workflow;
		console.log(task.state); // "Todo"
		console.log(task.data.title); // "Write complete documentation"
		console.log(result.events); // [{ type: "TaskRenamed", data: { taskId: "task-1", title: "Write complete documentation" } }]
	}
	// #endregion rename

	// #region start
	result = await router.dispatch(task, {
		type: "Start",
		payload: { assignee: "alice" },
	});

	if (result.ok) {
		task = result.workflow;
		console.log(task.state); // "InProgress"
		console.log(task.data); // { title: "Write complete documentation", assignee: "alice" }
		console.log(result.events[0]?.type); // "TaskStarted"
	}
	// #endregion start

	// #region complete
	result = await router.dispatch(task, {
		type: "Complete",
		payload: {},
	});

	if (result.ok) {
		task = result.workflow;
		console.log(task.state); // "Done"
		console.log(task.data); // { title: "Write complete documentation", completedAt: Date }
		console.log(result.events[0]?.type); // "TaskCompleted"
	}
	// #endregion complete
})();
