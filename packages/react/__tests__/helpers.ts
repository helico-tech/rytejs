import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

export const definition = defineWorkflow("todo", {
	states: {
		Pending: z.object({ title: z.string() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
		Rename: z.object({ title: z.string() }),
	},
	events: {
		TodoStarted: z.object({ assignee: z.string() }),
		TodoCompleted: z.object({ todoId: z.string() }),
	},
	errors: {
		AlreadyAssigned: z.object({ current: z.string() }),
	},
});

export type TodoConfig = (typeof definition)["config"];

export function createTestRouter() {
	const router = new WorkflowRouter(definition);

	router.state("Pending", ({ on }) => {
		on("Start", ({ command, transition, emit }) => {
			transition("InProgress", {
				title: "My Todo",
				assignee: command.payload.assignee,
			});
			emit({ type: "TodoStarted", data: { assignee: command.payload.assignee } });
		});
		on("Rename", ({ command, update }) => {
			update({ title: command.payload.title });
		});
	});

	router.state("InProgress", ({ on }) => {
		on("Complete", ({ workflow, transition, emit }) => {
			transition("Done", {
				title: workflow.data.title,
				completedAt: new Date(),
			});
			emit({ type: "TodoCompleted", data: { todoId: workflow.id } });
		});
		on("Rename", ({ command, update }) => {
			update({ title: command.payload.title });
		});
	});

	return router;
}
