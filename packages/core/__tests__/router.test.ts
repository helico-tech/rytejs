import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("test", {
	states: {
		draft: z.object({ title: z.string().optional() }),
		review: z.object({ title: z.string(), submittedBy: z.string() }),
		published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		archived: z.object({ reason: z.string() }),
	},
	commands: {
		setTitle: z.object({ title: z.string() }),
		submit: z.object({ submittedBy: z.string() }),
		publish: z.object({}),
		archive: z.object({ reason: z.string() }),
	},
	events: {
		TitleSet: z.object({ title: z.string() }),
		Submitted: z.object({ id: z.string() }),
		Published: z.object({ id: z.string() }),
		Archived: z.object({ id: z.string(), reason: z.string() }),
	},
	errors: {
		titleRequired: z.object({}),
		unauthorized: z.object({ required: z.string() }),
	},
});

type TestDeps = { logger: string[] };

function createDeps(): TestDeps {
	return { logger: [] };
}

const wf = {
	draft: (data: { title?: string } = {}) =>
		definition.createWorkflow("wf-1", { initialState: "draft", data }),
	review: (data: { title: string; submittedBy: string }) =>
		definition.createWorkflow("wf-1", { initialState: "review", data }),
	published: (data: { title: string; publishedAt: Date }) =>
		definition.createWorkflow("wf-1", { initialState: "published", data }),
	archived: (data: { reason: string }) =>
		definition.createWorkflow("wf-1", { initialState: "archived", data }),
};

describe("WorkflowRouter", () => {
	describe("basic dispatch", () => {
		test("dispatches command to correct state handler", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("setTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
					ctx.emit({ type: "TitleSet", data: { title: ctx.command.payload.title } });
				});
			});
			const result = await app.dispatch(wf.draft(), {
				type: "setTitle",
				payload: { title: "Hello" },
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error();
			expect(result.workflow.state).toBe("draft");
			if (result.workflow.state === "draft") {
				expect(result.workflow.data.title).toBe("Hello");
			}
			expect(result.events).toHaveLength(1);
		});

		test("handler can transition to a new state", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("submit", (ctx) => {
					ctx.transition("review", {
						title: ctx.data.title ?? "untitled",
						submittedBy: ctx.command.payload.submittedBy,
					});
					ctx.emit({ type: "Submitted", data: { id: ctx.workflow.id } });
				});
			});
			const result = await app.dispatch(wf.draft({ title: "Test" }), {
				type: "submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error();
			expect(result.workflow.state).toBe("review");
			expect(result.workflow.data).toEqual({ title: "Test", submittedBy: "user-1" });
		});
	});

	describe("command validation", () => {
		test("invalid command payload returns validation error", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (s) => s.on("setTitle", () => {}));
			const result = await app.dispatch(wf.draft(), {
				type: "setTitle",
				payload: {} as any,
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("validation");
			if (result.error.category === "validation") expect(result.error.source).toBe("command");
		});
	});

	describe("router errors", () => {
		test("NO_HANDLER when no handler registered for state/command", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			const result = await app.dispatch(wf.draft(), {
				type: "setTitle",
				payload: { title: "x" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("router");
			if (result.error.category === "router") expect(result.error.code).toBe("NO_HANDLER");
		});

		test("UNKNOWN_STATE when workflow state not in definition", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			const badWf = {
				id: "wf-bad",
				definitionName: "test",
				state: "nonexistent",
				data: {},
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any;
			const result = await app.dispatch(badWf, {
				type: "setTitle",
				payload: { title: "x" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("router");
			if (result.error.category === "router") expect(result.error.code).toBe("UNKNOWN_STATE");
		});
	});

	describe("domain errors", () => {
		test("ctx.error returns domain error in result", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("submit", (ctx) => {
					if (!ctx.data.title) ctx.error({ code: "titleRequired", data: {} });
				});
			});
			const result = await app.dispatch(wf.draft(), {
				type: "submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("domain");
			if (result.error.category === "domain") expect(result.error.code).toBe("titleRequired");
		});
	});

	describe("provisional mutation", () => {
		test("error discards state changes", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("submit", (ctx) => {
					ctx.update({ title: "modified" });
					ctx.error({ code: "titleRequired", data: {} });
				});
			});
			const original = wf.draft({ title: "original" });
			const result = await app.dispatch(original, {
				type: "submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(false);
			if (original.state === "draft") {
				expect(original.data.title).toBe("original");
			}
		});
	});

	describe("global middleware", () => {
		test("global middleware wraps dispatch", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.use(async (ctx, next) => {
				log.push(`before:${ctx.command.type}`);
				await next();
				log.push(`after:${ctx.command.type}`);
			});
			app.state("draft", (s) => {
				s.on("setTitle", (ctx) => {
					log.push("handler");
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			await app.dispatch(wf.draft(), { type: "setTitle", payload: { title: "x" } });
			expect(log).toEqual(["before:setTitle", "handler", "after:setTitle"]);
		});
	});

	describe("state-scoped middleware", () => {
		test("state middleware only runs for that state's handlers", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("draft-middleware");
					await next();
				});
				state.on("setTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			app.state("review", (state) => {
				state.on("publish", (ctx) => {
					ctx.transition("published", {
						title: ctx.data.title,
						publishedAt: new Date(),
					});
				});
			});
			await app.dispatch(wf.draft(), { type: "setTitle", payload: { title: "x" } });
			expect(log).toEqual(["draft-middleware"]);
			log.length = 0;
			await app.dispatch(wf.review({ title: "Test", submittedBy: "u" }), {
				type: "publish",
				payload: {},
			});
			expect(log).toEqual([]);
		});

		test("state middleware does NOT run for wildcard handlers", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("draft-middleware");
					await next();
				});
				state.on("setTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			app.on("*", "archive", (ctx) => {
				log.push("wildcard-handler");
				ctx.transition("archived", { reason: ctx.command.payload.reason });
			});
			await app.dispatch(wf.draft(), { type: "archive", payload: { reason: "x" } });
			expect(log).toEqual(["wildcard-handler"]);
		});

		test("additive middleware accumulates across app.state calls", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("mw-1");
					await next();
				});
			});
			app.state("draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("mw-2");
					await next();
				});
				state.on("setTitle", (ctx) => {
					log.push("handler");
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			await app.dispatch(wf.draft(), { type: "setTitle", payload: { title: "x" } });
			expect(log).toEqual(["mw-1", "mw-2", "handler"]);
		});
	});

	describe("inline middleware", () => {
		test("inline middleware runs before handler", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on(
					"setTitle",
					async (_ctx, next) => {
						log.push("inline");
						await next();
					},
					(ctx) => {
						log.push("handler");
						ctx.update({ title: ctx.command.payload.title });
					},
				);
			});
			await app.dispatch(wf.draft(), { type: "setTitle", payload: { title: "x" } });
			expect(log).toEqual(["inline", "handler"]);
		});
	});

	describe("wildcard handlers", () => {
		test("wildcard matches any state", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.on("*", "archive", (ctx) => {
				ctx.transition("archived", { reason: ctx.command.payload.reason });
			});
			let result = await app.dispatch(wf.draft(), {
				type: "archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("archived");
			result = await app.dispatch(wf.review({ title: "T", submittedBy: "u" }), {
				type: "archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("archived");
		});

		test("specific state handler takes priority over wildcard", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("archive", (ctx) => {
					log.push("specific");
					ctx.transition("archived", { reason: ctx.command.payload.reason });
				});
			});
			app.on("*", "archive", (ctx) => {
				log.push("wildcard");
				ctx.transition("archived", { reason: ctx.command.payload.reason });
			});
			await app.dispatch(wf.draft(), { type: "archive", payload: { reason: "x" } });
			expect(log).toEqual(["specific"]);
		});
	});

	describe("multi-state handlers", () => {
		test("handler registered for multiple states works", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state(["draft", "review"] as const, (state) => {
				state.on("archive", (ctx) => {
					ctx.transition("archived", { reason: ctx.command.payload.reason });
				});
			});
			let result = await app.dispatch(wf.draft(), {
				type: "archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("archived");
			result = await app.dispatch(wf.review({ title: "T", submittedBy: "u" }), {
				type: "archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("archived");
		});

		test("specific state takes priority over multi-state", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("archive", (ctx) => {
					log.push("specific");
					ctx.transition("archived", { reason: ctx.command.payload.reason });
				});
			});
			app.state(["draft", "review"] as const, (state) => {
				state.on("archive", (ctx) => {
					log.push("multi");
					ctx.transition("archived", { reason: ctx.command.payload.reason });
				});
			});
			await app.dispatch(wf.draft(), { type: "archive", payload: { reason: "x" } });
			expect(log).toEqual(["specific"]);
		});

		test("multi-state takes priority over wildcard", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state(["draft", "review"] as const, (state) => {
				state.on("archive", (ctx) => {
					log.push("multi");
					ctx.transition("archived", { reason: ctx.command.payload.reason });
				});
			});
			app.on("*", "archive", (ctx) => {
				log.push("wildcard");
				ctx.transition("archived", { reason: ctx.command.payload.reason });
			});
			await app.dispatch(wf.draft(), { type: "archive", payload: { reason: "x" } });
			expect(log).toEqual(["multi"]);
		});
	});

	describe("additive state registration", () => {
		test("multiple app.state calls for same state accumulate handlers", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("setTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			app.state("draft", (state) => {
				state.on("submit", (ctx) => {
					ctx.transition("review", {
						title: ctx.data.title ?? "untitled",
						submittedBy: ctx.command.payload.submittedBy,
					});
				});
			});
			let result = await app.dispatch(wf.draft(), {
				type: "setTitle",
				payload: { title: "Test" },
			});
			expect(result.ok).toBe(true);
			result = await app.dispatch(wf.draft({ title: "Test" }), {
				type: "submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("review");
		});

		test("later registration for same state/command wins", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (s) => {
				s.on("setTitle", () => {
					log.push("first");
				});
			});
			app.state("draft", (s) => {
				s.on("setTitle", () => {
					log.push("second");
				});
			});
			await app.dispatch(wf.draft(), { type: "setTitle", payload: { title: "x" } });
			expect(log).toEqual(["second"]);
		});
	});

	describe("middleware execution order", () => {
		test("full onion: global → state → inline → handler", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.use(async (_ctx, next) => {
				log.push("global-before");
				await next();
				log.push("global-after");
			});
			app.state("draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("state-before");
					await next();
					log.push("state-after");
				});
				state.on(
					"setTitle",
					async (_ctx, next) => {
						log.push("inline-before");
						await next();
						log.push("inline-after");
					},
					(ctx) => {
						log.push("handler");
						ctx.update({ title: ctx.command.payload.title });
					},
				);
			});
			await app.dispatch(wf.draft(), { type: "setTitle", payload: { title: "x" } });
			expect(log).toEqual([
				"global-before",
				"state-before",
				"inline-before",
				"handler",
				"inline-after",
				"state-after",
				"global-after",
			]);
		});
	});

	describe("async handlers", () => {
		test("async handler works correctly", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("draft", (state) => {
				state.on("setTitle", async (ctx) => {
					await new Promise((resolve) => setTimeout(resolve, 1));
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			const result = await app.dispatch(wf.draft(), {
				type: "setTitle",
				payload: { title: "async-title" },
			});
			expect(result.ok).toBe(true);
			if (result.ok && result.workflow.state === "draft") {
				expect(result.workflow.data.title).toBe("async-title");
			}
		});
	});
});
