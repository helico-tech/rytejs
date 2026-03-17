import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region basic
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
	},
	errors: {
		AlreadyAssigned: z.object({ currentAssignee: z.string() }),
		NotAssigned: z.object({}),
		DeadlinePassed: z.object({ deadline: z.coerce.date() }),
	},
});
// #endregion basic

// Set up a router for the handler-error and result-check regions
const router = new WorkflowRouter(taskWorkflow);

// #region handler-error
router.state("Todo", ({ on }) => {
	on("Start", ({ command, error, transition, data }) => {
		if (!command.payload.assignee) {
			error({ code: "NotAssigned", data: {} });
		}
		// only runs if no error was raised
		transition("InProgress", { title: data.title, assignee: command.payload.assignee });
	});
});
// #endregion handler-error

// Create a task instance for the result-check region
const taskForDispatch = taskWorkflow.createWorkflow("task-dispatch", {
	initialState: "Todo",
	data: { title: "Write docs", priority: 0 },
});

// #region result-check
(async () => {
	const result = await router.dispatch(taskForDispatch, { type: "Start", payload: {} });

	if (!result.ok && result.error.category === "domain") {
		result.error.code; // "AlreadyAssigned" | "NotAssigned" | "DeadlinePassed"
		result.error.data; // typed based on the code
	}
})();
// #endregion result-check

// #region create
const task = taskWorkflow.createWorkflow("task-1", {
	initialState: "Todo",
	data: { title: "Write docs", priority: 0 },
});

console.log(task.id); // "task-1"
console.log(task.state); // "Todo"
console.log(task.data); // { title: "Write docs", priority: 0 }
// #endregion create

// #region create-throws
// Throws: Invalid initial data for state 'Todo': Required
taskWorkflow.createWorkflow("bad", {
	initialState: "Todo",
	// @ts-expect-error — intentionally missing required 'title' to show runtime validation
	data: {},
});
// #endregion create-throws

// #region accessors
taskWorkflow.getStateSchema("Todo"); // ZodObject for Todo state
taskWorkflow.getCommandSchema("Start"); // ZodObject for Start command
taskWorkflow.getEventSchema("TaskStarted"); // ZodObject for TaskStarted event
taskWorkflow.getErrorSchema("AlreadyAssigned"); // ZodObject for error
// #endregion accessors

// #region has-state
taskWorkflow.hasState("Todo"); // true
taskWorkflow.hasState("unknown"); // false
// #endregion has-state

// #region complete
const articleWorkflow = defineWorkflow("article", {
	states: {
		Draft: z.object({ title: z.string(), body: z.string().optional() }),
		Review: z.object({
			title: z.string(),
			body: z.string(),
			reviewerId: z.string(),
		}),
		Published: z.object({
			title: z.string(),
			body: z.string(),
			publishedAt: z.coerce.date(),
		}),
	},
	commands: {
		UpdateDraft: z.object({
			title: z.string().optional(),
			body: z.string().optional(),
		}),
		SubmitForReview: z.object({ reviewerId: z.string() }),
		Approve: z.object({}),
	},
	events: {
		DraftUpdated: z.object({ articleId: z.string() }),
		SubmittedForReview: z.object({
			articleId: z.string(),
			reviewerId: z.string(),
		}),
		ArticlePublished: z.object({ articleId: z.string() }),
	},
	errors: {
		BodyRequired: z.object({}),
	},
});
// #endregion complete

// Suppress unused variable warnings
void articleWorkflow;
void task;
