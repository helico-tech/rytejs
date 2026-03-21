import { createKey, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// Docs-only workflow definition covering all states and commands used on this page.
const articleWorkflow = defineWorkflow("article", {
	states: {
		Draft: z.object({ title: z.string(), body: z.string().optional() }),
		Review: z.object({ title: z.string(), body: z.string(), reviewerId: z.string() }),
		Published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		UpdateDraft: z.object({ title: z.string().optional(), body: z.string().optional() }),
		Submit: z.object({ reviewerId: z.string() }),
		SubmitForReview: z.object({ reviewerId: z.string() }),
		Approve: z.object({}),
		SetTitle: z.object({ title: z.string() }),
	},
	events: {
		DraftUpdated: z.object({ articleId: z.string() }),
	},
	errors: {
		BodyRequired: z.object({}),
		Unauthorized: z.object({ required: z.string() }),
	},
});

// ── #global ───────────────────────────────────────────────────────────────────

const router = new WorkflowRouter(articleWorkflow);

// #region global
router.use(async ({ command }, next) => {
	const start = Date.now();
	await next();
	console.log(`${command.type} took ${Date.now() - start}ms`);
});
// #endregion global

// ── #state-scoped ─────────────────────────────────────────────────────────────

// #region state-scoped
router.state("Draft", ({ on, use }) => {
	use(async (_ctx, next) => {
		console.log("entering Draft handler");
		await next();
	});

	on("UpdateDraft", ({ command, update }) => {
		update({ title: command.payload.title });
	});
});
// #endregion state-scoped

// ── #inline ───────────────────────────────────────────────────────────────────

const inlineRouter = new WorkflowRouter(articleWorkflow);

// #region inline
inlineRouter.state("Draft", ({ on }) => {
	on(
		"Submit",
		async ({ data, error }, next) => {
			if (!data.body) {
				error({ code: "BodyRequired", data: {} });
			}
			await next();
		},
		({ data, command, transition }) => {
			transition("Review", {
				title: data.title,
				// biome-ignore lint/style/noNonNullAssertion: guarded by conditional logic in middleware above
				body: data.body!,
				reviewerId: command.payload.reviewerId,
			});
		},
	);
});
// #endregion inline

// ── #execution-order ──────────────────────────────────────────────────────────

const execRouter = new WorkflowRouter(articleWorkflow);

const workflow = articleWorkflow.createWorkflow("article-1", {
	initialState: "Draft",
	data: { title: "Hello" },
});

// #region execution-order
const log: string[] = [];

execRouter.use(async (_ctx, next) => {
	log.push("global-before");
	await next();
	log.push("global-after");
});

execRouter.state("Draft", ({ on, use }) => {
	use(async (_ctx, next) => {
		log.push("state-before");
		await next();
		log.push("state-after");
	});

	on(
		"SetTitle",
		async (_ctx, next) => {
			log.push("inline-before");
			await next();
			log.push("inline-after");
		},
		({ command, update }) => {
			log.push("handler");
			update({ title: command.payload.title });
		},
	);
});

(async () => {
	await execRouter.dispatch(workflow, { type: "SetTitle", payload: { title: "x" } });
	// log: ["global-before", "state-before", "inline-before", "handler",
	//        "inline-after", "state-after", "global-after"]
})();
// #endregion execution-order

// ── #auth ─────────────────────────────────────────────────────────────────────

const UserKey = createKey<{ id: string; role: string }>("user");

const authRouter = new WorkflowRouter(articleWorkflow);

// #region auth
authRouter.use(async ({ set }, next) => {
	// In a real app, extract user from a token or session
	set(UserKey, { id: "user-1", role: "admin" });
	await next();
});

authRouter.state("Review", ({ on }) => {
	on("Approve", ({ get, error, data, transition }) => {
		const user = get(UserKey);
		if (user.role !== "admin") {
			error({ code: "Unauthorized", data: { required: "admin" } });
		}
		transition("Published", {
			title: data.title,
			body: data.body,
			publishedAt: new Date(),
		});
	});
});
// #endregion auth

// ── #logging ──────────────────────────────────────────────────────────────────

const loggingRouter = new WorkflowRouter(articleWorkflow);

// #region logging
loggingRouter.use(async ({ workflow, command }, next) => {
	console.log(`[${workflow.state}] ${command.type}`, command.payload);
	await next();
});
// #endregion logging

void inlineRouter;
void authRouter;
void loggingRouter;
