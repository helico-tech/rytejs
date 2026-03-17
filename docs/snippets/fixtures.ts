import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// ── Task workflow (3-state: Todo → InProgress → Done) ──────────────────

export const taskWorkflow = defineWorkflow("task", {
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
		TaskRenamed: z.object({ taskId: z.string(), title: z.string() }),
	},
	errors: {
		AlreadyAssigned: z.object({ currentAssignee: z.string() }),
		NotAssigned: z.object({}),
	},
});

export const taskRouter = new WorkflowRouter(taskWorkflow);

taskRouter.state("Todo", ({ on }) => {
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
	on("Rename", ({ command, update, emit, workflow }) => {
		update({ title: command.payload.title });
		emit({
			type: "TaskRenamed",
			data: { taskId: workflow.id, title: command.payload.title },
		});
	});
});

taskRouter.state("InProgress", ({ on }) => {
	on("Complete", ({ data, transition, emit, workflow }) => {
		transition("Done", {
			title: data.title,
			completedAt: new Date(),
		});
		emit({
			type: "TaskCompleted",
			data: { taskId: workflow.id },
		});
	});
});

// ── Article workflow (3-state: Draft → Review → Published) ─────────────

export const articleWorkflow = defineWorkflow("article", {
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
		Publish: z.object({}),
		SetTitle: z.object({ title: z.string() }),
		Submit: z.object({ reviewerId: z.string() }),
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
		Unauthorized: z.object({ required: z.string() }),
	},
});
