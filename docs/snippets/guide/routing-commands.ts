import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// Docs-only workflow definition covering all states and commands used on this page.
const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), priority: z.number().optional() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string() }),
		Draft: z.object({ title: z.string(), body: z.string().optional() }),
		Review: z.object({ title: z.string(), assignee: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
		Rename: z.object({ title: z.string() }),
		SetTitle: z.object({ title: z.string() }),
		Submit: z.object({ assignee: z.string() }),
		Approve: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		TaskStarted: z.object({ taskId: z.string(), assignee: z.string() }),
	},
	errors: {
		GenericError: z.object({}),
	},
});

// Stubs for the deps example
declare const db: unknown;
declare const logger: unknown;

// #region create-router
// Without dependencies
const router = new WorkflowRouter(taskWorkflow);

// With typed dependencies
const routerWithDeps = new WorkflowRouter(taskWorkflow, { db, logger });
// #endregion create-router

// #region single-state
router.state("Todo", ({ on }) => {
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

	on("Rename", ({ command, update }) => {
		update({ title: command.payload.title });
	});
});
// #endregion single-state

// #region multi-state
router.state(["Todo", "InProgress"] as const, ({ on }) => {
	on("Rename", ({ command, update }) => {
		update({ title: command.payload.title });
	});
});
// #endregion multi-state

// #region wildcard
router.on("*", "Archive", ({ command, transition }) => {
	transition("Archived", { reason: command.payload.reason });
});
// #endregion wildcard

// Priority example uses a separate router to avoid handler conflicts with #wildcard above
const priorityRouter = new WorkflowRouter(taskWorkflow);

// #region priority
// "Draft" + "Archive" -> uses specific handler
priorityRouter.state("Draft", ({ on }) => {
	on("Archive", () => {
		/* runs for Draft */
	});
});

// ["Draft", "Review"] + "Archive" -> used for Review, not Draft
priorityRouter.state(["Draft", "Review"] as const, ({ on }) => {
	on("Archive", () => {
		/* runs for Review */
	});
});

// "*" + "Archive" -> fallback for all other states
priorityRouter.on("*", "Archive", () => {
	/* runs for Published, etc. */
});
// #endregion priority

// #region composable
const draftRouter = new WorkflowRouter(taskWorkflow);
draftRouter.state("Draft", ({ on }) => {
	on("SetTitle", ({ command, update }) => {
		update({ title: command.payload.title });
	});
	on("Submit", ({ data, command, transition }) => {
		transition("Review", {
			title: data.title,
			assignee: command.payload.assignee,
		});
	});
});

const reviewRouter = new WorkflowRouter(taskWorkflow);
reviewRouter.state("Review", ({ on }) => {
	on("Approve", ({ data, transition }) => {
		transition("Published", {
			title: data.title,
			publishedAt: new Date(),
		});
	});
});

const composableRouter = new WorkflowRouter(taskWorkflow);
composableRouter.use(draftRouter);
composableRouter.use(reviewRouter);
// #endregion composable

// #region nested
const inner = new WorkflowRouter(taskWorkflow);
inner.state("Draft", ({ on }) => {
	on("SetTitle", ({ command, update }) => {
		update({ title: command.payload.title });
	});
});

const middle = new WorkflowRouter(taskWorkflow);
middle.use(inner);

const outer = new WorkflowRouter(taskWorkflow);
outer.use(middle);
// #endregion nested

// Workflow instances for dispatch and result-check regions
const workflow = taskWorkflow.createWorkflow("task-1", {
	initialState: "Todo",
	data: { title: "Write docs" },
});

const task = taskWorkflow.createWorkflow("task-2", {
	initialState: "Todo",
	data: { title: "Write more docs" },
});

// #region dispatch
const _result = await router.dispatch(workflow, {
	type: "Start",
	payload: { assignee: "alice" },
});
// #endregion dispatch

// #region result-check
(async () => {
	const result = await router.dispatch(task, {
		type: "Start",
		payload: { assignee: "alice" },
	});

	if (result.ok) {
		console.log(result.workflow.state); // narrowed to updated state
		console.log(result.events); // events emitted during dispatch
	} else {
		console.log(result.error.category); // "validation" | "domain" | "router"
	}
})();
// #endregion result-check

void routerWithDeps;
void priorityRouter;
void composableRouter;
void outer;
