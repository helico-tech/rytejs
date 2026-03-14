import { defineWorkflow, type Workflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		InProgress: z.object({ title: z.string(), assignee: z.string(), startedAt: z.coerce.date() }),
		Done: z.object({ title: z.string(), assignee: z.string(), completedAt: z.coerce.date() }),
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

const router = new WorkflowRouter(taskWorkflow)
	.state("Todo", (state) => {
		state
			.on("Assign", (ctx) => {
				ctx.update({ assignee: ctx.command.payload.assignee });
				ctx.emit({
					type: "TaskAssigned",
					data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee },
				});
			})
			.on("Start", (ctx) => {
				const assignee = ctx.data.assignee;
				if (!assignee) {
					ctx.error({ code: "NotAssigned", data: {} });
				}
				ctx.transition("InProgress", {
					title: ctx.data.title,
					assignee,
					startedAt: new Date(),
				});
				ctx.emit({ type: "TaskStarted", data: { taskId: ctx.workflow.id } });
			});
	})
	.state("InProgress", (state) => {
		state.on("Complete", (ctx) => {
			ctx.transition("Done", {
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
		initialState: "Todo",
		data: { title: "Write documentation" },
	});
	console.log(`Created: ${task.state}`, task.data);

	let result = await router.dispatch(task, {
		type: "Assign",
		payload: { assignee: "alice" },
	});
	if (result.ok) {
		task = result.workflow;
		console.log(`Assigned: ${task.state}`, task.data);
		console.log("Events:", result.events);
	}

	result = await router.dispatch(task, { type: "Start", payload: {} });
	if (result.ok) {
		task = result.workflow;
		console.log(`Started: ${task.state}`, task.data);
	}

	result = await router.dispatch(task, { type: "Complete", payload: {} });
	if (result.ok) {
		task = result.workflow;
		console.log(`Done: ${task.state}`, task.data);
	}
}

main().catch(console.error);
