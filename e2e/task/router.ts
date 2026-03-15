import { WorkflowRouter } from "@rytejs/core";
import { taskWorkflow } from "./definition.ts";

const todoRouter = new WorkflowRouter(taskWorkflow).state("Todo", ({ on }) => {
	on("Assign", ({ command, update, emit, workflow }) => {
		update({ assignee: command.payload.assignee });
		emit({
			type: "TaskAssigned",
			data: {
				taskId: workflow.id,
				assignee: command.payload.assignee,
			},
		});
	});

	on("Start", ({ data, error, transition, emit, workflow }) => {
		const { assignee } = data;
		if (!assignee) {
			error({ code: "NotAssigned", data: {} });
			return;
		}
		transition("InProgress", {
			title: data.title,
			assignee,
			startedAt: new Date(),
		});
		emit({ type: "TaskStarted", data: { taskId: workflow.id } });
	});
});

const inProgressRouter = new WorkflowRouter(taskWorkflow).state("InProgress", ({ on }) => {
	on("Complete", ({ data, transition, emit, workflow }) => {
		transition("Done", {
			title: data.title,
			assignee: data.assignee,
			completedAt: new Date(),
		});
		emit({
			type: "TaskCompleted",
			data: { taskId: workflow.id },
		});
	});
});

// Compose routers
export const router = new WorkflowRouter(taskWorkflow).use(todoRouter).use(inProgressRouter);
