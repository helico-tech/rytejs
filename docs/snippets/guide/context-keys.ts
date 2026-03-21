import { createKey, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region create-keys
const UserKey = createKey<{ id: string; role: string }>("user");
const RequestIdKey = createKey<string>("requestId");
// #endregion create-keys

// ── #set-values ───────────────────────────────────────────────────────────────

const _setValuesWorkflow = defineWorkflow("article", {
	states: {
		Draft: z.object({ title: z.string() }),
	},
	commands: {
		Publish: z.object({}),
	},
	events: {},
	errors: {},
});

const keyRouter = new WorkflowRouter(_setValuesWorkflow);

// #region set-values
keyRouter.use(async ({ set }, next) => {
	set(UserKey, { id: "user-1", role: "admin" });
	set(RequestIdKey, crypto.randomUUID());
	await next();
});
// #endregion set-values

// ── #complete ─────────────────────────────────────────────────────────────────

// #region complete
// 1. Define a typed key
const AuthKey = createKey<{ userId: string; role: "viewer" | "editor" | "admin" }>("auth");

// 2. Define workflow
const articleWorkflow = defineWorkflow("article", {
	states: {
		Draft: z.object({ title: z.string(), body: z.string().optional() }),
		Published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		Publish: z.object({}),
	},
	events: {
		ArticlePublished: z.object({ articleId: z.string(), publishedBy: z.string() }),
	},
	errors: {
		Unauthorized: z.object({ required: z.string() }),
		BodyRequired: z.object({}),
	},
});

// 3. Create router
const router = new WorkflowRouter(articleWorkflow);

// 4. Auth middleware sets the key
router.use(async ({ set }, next) => {
	// In a real app: validate JWT, look up session, etc.
	const auth = { userId: "user-1", role: "editor" as const };
	set(AuthKey, auth);
	await next();
});

// 5. Handler reads the key
router.state("Draft", ({ on }) => {
	on("Publish", ({ get, error, data, transition, emit, workflow }) => {
		const auth = get(AuthKey);

		if (auth.role === "viewer") {
			error({ code: "Unauthorized", data: { required: "editor" } });
		}

		if (!data.body) {
			error({ code: "BodyRequired", data: {} });
		}

		transition("Published", {
			title: data.title,
			// biome-ignore lint/style/noNonNullAssertion: guarded by error() check above
			body: data.body!,
			publishedAt: new Date(),
		});

		emit({
			type: "ArticlePublished",
			data: { articleId: workflow.id, publishedBy: auth.userId },
		});
	});
});
// #endregion complete

void keyRouter;
void router;
