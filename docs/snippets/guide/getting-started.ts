import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region define
const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Complete: z.object({}),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotAssigned: z.object({}),
	},
});
// #endregion define

// #region router
const router = new WorkflowRouter(taskWorkflow).state("Todo", ({ on }) => {
	on("Complete", ({ data, error, transition, emit, workflow }) => {
		if (!data.assignee) {
			error({ code: "NotAssigned", data: {} });
		}
		transition("Done", {
			title: data.title,
			completedAt: new Date(),
		});
		emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
	});
});
// #endregion router

// #region dispatch
(async () => {
	const task = taskWorkflow.createWorkflow("task-1", {
		initialState: "Todo",
		data: { title: "Read the docs", assignee: "alice" },
	});

	const result = await router.dispatch(task, {
		type: "Complete",
		payload: {},
	});

	if (result.ok) {
		console.log(result.workflow.state); // "Done"
		console.log(result.events[0]?.type); // "TaskCompleted"
	} else if (result.error.category === "domain") {
		console.log(result.error.code); // "NotAssigned"
	}
})();
// #endregion dispatch
