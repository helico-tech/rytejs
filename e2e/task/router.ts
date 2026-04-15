import { WorkflowRouter } from "@rytejs/core";
import { taskWorkflow } from "./definition.ts";

const todoRouter = new WorkflowRouter(taskWorkflow).state("Todo", ({ on }) => {
	on("Assign", ({ command, update, emit, workflow }) => {
		update({ assignee: command.payload.assignee });
		emit("TaskAssigned", {
			taskId: workflow.id,
			assignee: command.payload.assignee,
		});
	});

	on("Start", ({ data, error, transition, emit, workflow }) => {
		const { assignee } = data;
		if (!assignee) {
			error("NotAssigned", {});
			return;
		}
		transition("InProgress", {
			title: data.title,
			assignee,
			startedAt: new Date(),
		});
		emit("TaskStarted", { taskId: workflow.id });
	});
});

const inProgressRouter = new WorkflowRouter(taskWorkflow).state("InProgress", ({ on }) => {
	on("Complete", ({ data, transition, emit, workflow }) => {
		transition("Done", {
			title: data.title,
			assignee: data.assignee,
			completedAt: new Date(),
		});
		emit("TaskCompleted", { taskId: workflow.id });
	});
});

// Compose routers
export const router = new WorkflowRouter(taskWorkflow).use(todoRouter).use(inProgressRouter);
