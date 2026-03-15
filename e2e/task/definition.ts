import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

export const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		InProgress: z.object({
			title: z.string(),
			assignee: z.string(),
			startedAt: z.coerce.date(),
		}),
		Done: z.object({
			title: z.string(),
			assignee: z.string(),
			completedAt: z.coerce.date(),
		}),
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
