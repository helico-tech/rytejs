import { defineWorkflow, type Workflow, WorkflowRouter } from "@ryte/core";
import { z } from "zod";

const taskWorkflow = defineWorkflow("task", {
	states: {
		todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		inProgress: z.object({ title: z.string(), assignee: z.string(), startedAt: z.coerce.date() }),
		done: z.object({ title: z.string(), assignee: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		assign: z.object({ assignee: z.string() }),
		start: z.object({}),
		complete: z.object({}),
	},
	events: {
		TaskAssigned: z.object({ taskId: z.string(), assignee: z.string() }),
		TaskStarted: z.object({ taskId: z.string() }),
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		notAssigned: z.object({}),
	},
});

const router = new WorkflowRouter(taskWorkflow);

router.state("todo", (state) => {
	state.on("assign", (ctx) => {
		ctx.update({ assignee: ctx.command.payload.assignee });
		ctx.emit({
			type: "TaskAssigned",
			data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee },
		});
	});

	state.on("start", (ctx) => {
		const assignee = ctx.data.assignee;
		if (!assignee) {
			ctx.error({ code: "notAssigned", data: {} });
		}
		ctx.transition("inProgress", {
			title: ctx.data.title,
			assignee,
			startedAt: new Date(),
		});
		ctx.emit({ type: "TaskStarted", data: { taskId: ctx.workflow.id } });
	});
});

router.state("inProgress", (state) => {
	state.on("complete", (ctx) => {
		ctx.transition("done", {
			title: ctx.data.title,
			assignee: ctx.data.assignee,
			completedAt: new Date(),
		});
		ctx.emit({ type: "TaskCompleted", data: { taskId: ctx.workflow.id } });
	});
});

type TaskWorkflow = Workflow<typeof taskWorkflow.config>;

async function main() {
	let task: TaskWorkflow = taskWorkflow.createWorkflow("task-1", {
		initialState: "todo",
		data: { title: "Write documentation" },
	});
	console.log(`Created: ${task.state}`, task.data);

	let result = await router.dispatch(task, {
		type: "assign",
		payload: { assignee: "alice" },
	});
	if (result.ok) {
		task = result.workflow;
		console.log(`Assigned: ${task.state}`, task.data);
		console.log("Events:", result.events);
	}

	result = await router.dispatch(task, { type: "start", payload: {} });
	if (result.ok) {
		task = result.workflow;
		console.log(`Started: ${task.state}`, task.data);
	}

	result = await router.dispatch(task, { type: "complete", payload: {} });
	if (result.ok) {
		task = result.workflow;
		console.log(`Done: ${task.state}`, task.data);
	}
}

main().catch(console.error);
