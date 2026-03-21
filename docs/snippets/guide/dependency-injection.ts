import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// ── Stubs for #providing ──────────────────────────────────────────────────────

declare class Database {}
declare class EmailService {}

// ── Docs-only workflow for #providing (taskWorkflow with no deps) ─────────────

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({ title: z.string() }),
	},
	commands: {
		Complete: z.object({}),
	},
	events: {},
	errors: {},
});

// #region providing
type TaskDeps = {
	db: Database;
	emailService: EmailService;
};

const taskDeps: TaskDeps = {
	db: new Database(),
	emailService: new EmailService(),
};

const taskRouter = new WorkflowRouter(taskWorkflow, taskDeps);
// #endregion providing

void taskRouter;

// ── Docs-only workflow for #accessing (article-like with Review/Published) ────

const reviewWorkflow = defineWorkflow("article", {
	states: {
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
		Approve: z.object({}),
	},
	events: {},
	errors: {
		NotReviewer: z.object({ expected: z.string() }),
	},
});

const accessRouter = new WorkflowRouter(reviewWorkflow, {
	reviewService: {
		canApprove(_reviewerId: string) {
			return true;
		},
	},
});

// #region accessing
accessRouter.state("Review", ({ on }) => {
	on("Approve", async ({ deps, data, error, transition }) => {
		const canApprove = deps.reviewService.canApprove(data.reviewerId);
		if (!canApprove) {
			error({ code: "NotReviewer", data: { expected: data.reviewerId } });
		}

		transition("Published", {
			title: data.title,
			body: data.body,
			publishedAt: new Date(),
		});
	});
});
// #endregion accessing

// ── #complete — fully self-contained article example ─────────────────────────

// #region complete
const articleWorkflow = defineWorkflow("article", {
	states: {
		Draft: z.object({ title: z.string(), body: z.string().optional() }),
		Published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		Publish: z.object({}),
	},
	events: {
		ArticlePublished: z.object({ articleId: z.string(), notifiedSubscribers: z.number() }),
	},
	errors: {
		BodyRequired: z.object({}),
	},
});

// Define dependencies
type _Deps = {
	notifier: { notifySubscribers(articleId: string): Promise<number> };
};

const router = new WorkflowRouter(articleWorkflow, {
	notifier: {
		async notifySubscribers(_articleId: string) {
			// send emails, push notifications, etc.
			return 42;
		},
	},
});

// Use deps in handler
router.state("Draft", ({ on }) => {
	on("Publish", async ({ data, deps, error, transition, emit, workflow }) => {
		if (!data.body) {
			error({ code: "BodyRequired", data: {} });
		}

		const count = await deps.notifier.notifySubscribers(workflow.id);

		transition("Published", {
			title: data.title,
			// biome-ignore lint/style/noNonNullAssertion: guarded by error() check above
			body: data.body!,
			publishedAt: new Date(),
		});

		emit({
			type: "ArticlePublished",
			data: { articleId: workflow.id, notifiedSubscribers: count },
		});
	});
});
// #endregion complete

// #region testing
const mockRouter = new WorkflowRouter(articleWorkflow, {
	notifier: {
		async notifySubscribers() {
			return 0; // no-op in tests
		},
	},
});
// #endregion testing

void mockRouter;
