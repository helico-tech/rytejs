import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// ── Local workflow definition — includes AssigneeNotified which is not in shared fixtures ──

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), priority: z.number().optional() }),
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
		AssigneeNotified: z.object({ assignee: z.string() }),
	},
	errors: {
		NotAssigned: z.object({}),
	},
});

const router = new WorkflowRouter(taskWorkflow);

// ── #emit ─────────────────────────────────────────────────────────────────────

// #region emit
router.state("Todo", ({ on }) => {
	on("Complete", ({ data, transition, emit, workflow }) => {
		transition("Done", {
			title: data.title,
			completedAt: new Date(),
		});
		emit("TaskCompleted", { taskId: workflow.id });
	});
});
// #endregion emit

// ── #emit-multiple ────────────────────────────────────────────────────────────

router.state("Todo", ({ on }) => {
	// #region emit-multiple
	on("Start", ({ data, command, transition, emit, workflow }) => {
		transition("InProgress", {
			title: data.title,
			assignee: command.payload.assignee,
		});
		emit("TaskStarted", { taskId: workflow.id, assignee: command.payload.assignee });
		emit("AssigneeNotified", { assignee: command.payload.assignee });
	});
	// #endregion emit-multiple
});

// ── #read-events ──────────────────────────────────────────────────────────────

// #region read-events
(async () => {
	const task = taskWorkflow.createWorkflow("task-1", {
		initialState: "Todo",
		data: { title: "Write docs" },
	});

	const result = await router.dispatch(task, "Complete", {});

	if (result.ok) {
		for (const event of result.events) {
			console.log(event.type, event.data);
			// "TaskCompleted" { taskId: "task-1" }
		}
	}
})();
// #endregion read-events

// ── #schema-validation ────────────────────────────────────────────────────────

// #region schema-validation
const workflow = defineWorkflow("task", {
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
	errors: {},
});

const validationRouter = new WorkflowRouter(workflow);

validationRouter.state("Todo", ({ on }) => {
	on("Complete", ({ data, transition, emit, workflow: _wf }) => {
		transition("Done", { title: data.title, completedAt: new Date() });
		// @ts-expect-error taskId must be a string, not a number
		emit("TaskCompleted", { taskId: 123 });
	});
});
// #endregion schema-validation

// ── #per-dispatch ─────────────────────────────────────────────────────────────

// #region per-dispatch
(async () => {
	const task = taskWorkflow.createWorkflow("task-2", {
		initialState: "Todo",
		data: { title: "Write more docs" },
	});

	const r1 = await router.dispatch(task, "Start", { assignee: "alice" });
	// r1.events: [{ type: "TaskStarted", ... }, { type: "AssigneeNotified", ... }]

	if (!r1.ok) throw new Error("dispatch failed");

	const _r2 = await router.dispatch(r1.workflow, "Complete", {});
	// r2.events: [{ type: "TaskCompleted", ... }]
	// TaskStarted is NOT in r2.events
})();
// #endregion per-dispatch

// ── #handling ─────────────────────────────────────────────────────────────────

declare const sendNotification: (data: unknown) => Promise<void>;
declare const updateDashboard: (data: unknown) => Promise<void>;

// #region handling
(async () => {
	const task = taskWorkflow.createWorkflow("task-3", {
		initialState: "Todo",
		data: { title: "Handle events" },
	});

	const result = await router.dispatch(task, "Start", { assignee: "alice" });

	if (result.ok) {
		for (const event of result.events) {
			switch (event.type) {
				case "TaskCompleted":
					await sendNotification(event.data);
					break;
				case "TaskStarted":
					await updateDashboard(event.data);
					break;
			}
		}
	}
})();
// #endregion handling

void validationRouter;
