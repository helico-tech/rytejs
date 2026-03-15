import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Review: z.object({ title: z.string(), submittedBy: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		SetTitle: z.object({ title: z.string() }),
		Submit: z.object({ submittedBy: z.string() }),
		Publish: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		TitleSet: z.object({ title: z.string() }),
		Submitted: z.object({ id: z.string() }),
		Published: z.object({ id: z.string() }),
		Archived: z.object({ id: z.string(), reason: z.string() }),
	},
	errors: {
		TitleRequired: z.object({}),
		Unauthorized: z.object({ required: z.string() }),
	},
});

type TestDeps = { logger: string[] };

function createDeps(): TestDeps {
	return { logger: [] };
}

const wf = {
	Draft: (data: { title?: string } = {}) =>
		definition.createWorkflow("wf-1", { initialState: "Draft", data }),
	Review: (data: { title: string; submittedBy: string }) =>
		definition.createWorkflow("wf-1", { initialState: "Review", data }),
	Published: (data: { title: string; publishedAt: Date }) =>
		definition.createWorkflow("wf-1", { initialState: "Published", data }),
	Archived: (data: { reason: string }) =>
		definition.createWorkflow("wf-1", { initialState: "Archived", data }),
};

describe("WorkflowRouter", () => {
	describe("basic dispatch", () => {
		test("dispatches command to correct state handler", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("SetTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
					ctx.emit({ type: "TitleSet", data: { title: ctx.command.payload.title } });
				});
			});
			const result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
				payload: { title: "Hello" },
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error();
			expect(result.workflow.state).toBe("Draft");
			if (result.workflow.state === "Draft") {
				expect(result.workflow.data.title).toBe("Hello");
			}
			expect(result.events).toHaveLength(1);
		});

		test("handler can transition to a new state", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("Submit", (ctx) => {
					ctx.transition("Review", {
						title: ctx.data.title ?? "untitled",
						submittedBy: ctx.command.payload.submittedBy,
					});
					ctx.emit({ type: "Submitted", data: { id: ctx.workflow.id } });
				});
			});
			const result = await app.dispatch(wf.Draft({ title: "Test" }), {
				type: "Submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error();
			expect(result.workflow.state).toBe("Review");
			expect(result.workflow.data).toEqual({ title: "Test", submittedBy: "user-1" });
		});
	});

	describe("command validation", () => {
		test("invalid command payload returns validation error", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (s) => s.on("SetTitle", () => {}));
			const result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
				// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid payload to test validation
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
			const result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
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
				// biome-ignore lint/suspicious/noExplicitAny: intentionally creating invalid workflow to test UNKNOWN_STATE
			} as any;
			const result = await app.dispatch(badWf, {
				type: "SetTitle",
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
			app.state("Draft", (state) => {
				state.on("Submit", (ctx) => {
					if (!ctx.data.title) ctx.error({ code: "TitleRequired", data: {} });
				});
			});
			const result = await app.dispatch(wf.Draft(), {
				type: "Submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("domain");
			if (result.error.category === "domain") expect(result.error.code).toBe("TitleRequired");
		});
	});

	describe("unexpected errors", () => {
		test("unexpected handler error returns error result with category 'unexpected'", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("SetTitle", () => {
					throw new TypeError("something broke");
				});
			});
			const result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
				payload: { title: "x" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("unexpected");
			if (result.error.category === "unexpected") {
				expect(result.error.message).toBe("something broke");
				expect(result.error.error).toBeInstanceOf(TypeError);
			}
		});

		test("unexpected non-Error throw returns error result", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("SetTitle", () => {
					throw "string error";
				});
			});
			const result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
				payload: { title: "x" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error();
			expect(result.error.category).toBe("unexpected");
			if (result.error.category === "unexpected") {
				expect(result.error.message).toBe("string error");
			}
		});

		test("dispatch:end hook fires even on unexpected errors", async () => {
			const endHook = vi.fn();
			const app = new WorkflowRouter(definition, createDeps());
			app.on("dispatch:start", () => {});
			app.on("dispatch:end", endHook);
			app.state("Draft", (state) => {
				state.on("SetTitle", () => {
					throw new Error("boom");
				});
			});
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
			expect(endHook).toHaveBeenCalledOnce();
		});
	});

	describe("provisional mutation", () => {
		test("error discards state changes", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("Submit", (ctx) => {
					ctx.update({ title: "modified" });
					ctx.error({ code: "TitleRequired", data: {} });
				});
			});
			const original = wf.Draft({ title: "original" });
			const result = await app.dispatch(original, {
				type: "Submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(false);
			if (original.state === "Draft") {
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
			app.state("Draft", (s) => {
				s.on("SetTitle", (ctx) => {
					log.push("handler");
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
			expect(log).toEqual(["before:SetTitle", "handler", "after:SetTitle"]);
		});
	});

	describe("state-scoped middleware", () => {
		test("state middleware only runs for that state's handlers", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("draft-middleware");
					await next();
				});
				state.on("SetTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			app.state("Review", (state) => {
				state.on("Publish", (ctx) => {
					ctx.transition("Published", {
						title: ctx.data.title,
						publishedAt: new Date(),
					});
				});
			});
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
			expect(log).toEqual(["draft-middleware"]);
			log.length = 0;
			await app.dispatch(wf.Review({ title: "Test", submittedBy: "u" }), {
				type: "Publish",
				payload: {},
			});
			expect(log).toEqual([]);
		});

		test("state middleware does NOT run for wildcard handlers", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("draft-middleware");
					await next();
				});
				state.on("SetTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			app.on("*", "Archive", (ctx) => {
				log.push("wildcard-handler");
				ctx.transition("Archived", { reason: ctx.command.payload.reason });
			});
			await app.dispatch(wf.Draft(), { type: "Archive", payload: { reason: "x" } });
			expect(log).toEqual(["wildcard-handler"]);
		});

		test("additive middleware accumulates across app.state calls", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("mw-1");
					await next();
				});
			});
			app.state("Draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("mw-2");
					await next();
				});
				state.on("SetTitle", (ctx) => {
					log.push("handler");
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
			expect(log).toEqual(["mw-1", "mw-2", "handler"]);
		});
	});

	describe("inline middleware", () => {
		test("inline middleware runs before handler", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on(
					"SetTitle",
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
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
			expect(log).toEqual(["inline", "handler"]);
		});
	});

	describe("wildcard handlers", () => {
		test("wildcard matches any state", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.on("*", "Archive", (ctx) => {
				ctx.transition("Archived", { reason: ctx.command.payload.reason });
			});
			let result = await app.dispatch(wf.Draft(), {
				type: "Archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("Archived");
			result = await app.dispatch(wf.Review({ title: "T", submittedBy: "u" }), {
				type: "Archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("Archived");
		});

		test("specific state handler takes priority over wildcard", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("Archive", (ctx) => {
					log.push("specific");
					ctx.transition("Archived", { reason: ctx.command.payload.reason });
				});
			});
			app.on("*", "Archive", (ctx) => {
				log.push("wildcard");
				ctx.transition("Archived", { reason: ctx.command.payload.reason });
			});
			await app.dispatch(wf.Draft(), { type: "Archive", payload: { reason: "x" } });
			expect(log).toEqual(["specific"]);
		});
	});

	describe("multi-state handlers", () => {
		test("handler registered for multiple states works", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state(["Draft", "Review"] as const, (state) => {
				state.on("Archive", (ctx) => {
					ctx.transition("Archived", { reason: ctx.command.payload.reason });
				});
			});
			let result = await app.dispatch(wf.Draft(), {
				type: "Archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("Archived");
			result = await app.dispatch(wf.Review({ title: "T", submittedBy: "u" }), {
				type: "Archive",
				payload: { reason: "x" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("Archived");
		});

		test("specific state takes priority over multi-state", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("Archive", (ctx) => {
					log.push("specific");
					ctx.transition("Archived", { reason: ctx.command.payload.reason });
				});
			});
			app.state(["Draft", "Review"] as const, (state) => {
				state.on("Archive", (ctx) => {
					log.push("multi");
					ctx.transition("Archived", { reason: ctx.command.payload.reason });
				});
			});
			await app.dispatch(wf.Draft(), { type: "Archive", payload: { reason: "x" } });
			expect(log).toEqual(["specific"]);
		});

		test("multi-state takes priority over wildcard", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state(["Draft", "Review"] as const, (state) => {
				state.on("Archive", (ctx) => {
					log.push("multi");
					ctx.transition("Archived", { reason: ctx.command.payload.reason });
				});
			});
			app.on("*", "Archive", (ctx) => {
				log.push("wildcard");
				ctx.transition("Archived", { reason: ctx.command.payload.reason });
			});
			await app.dispatch(wf.Draft(), { type: "Archive", payload: { reason: "x" } });
			expect(log).toEqual(["multi"]);
		});
	});

	describe("additive state registration", () => {
		test("multiple app.state calls for same state accumulate handlers", async () => {
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (state) => {
				state.on("SetTitle", (ctx) => {
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			app.state("Draft", (state) => {
				state.on("Submit", (ctx) => {
					ctx.transition("Review", {
						title: ctx.data.title ?? "untitled",
						submittedBy: ctx.command.payload.submittedBy,
					});
				});
			});
			let result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
				payload: { title: "Test" },
			});
			expect(result.ok).toBe(true);
			result = await app.dispatch(wf.Draft({ title: "Test" }), {
				type: "Submit",
				payload: { submittedBy: "user-1" },
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.workflow.state).toBe("Review");
		});

		test("later registration for same state/command wins", async () => {
			const log: string[] = [];
			const app = new WorkflowRouter(definition, createDeps());
			app.state("Draft", (s) => {
				s.on("SetTitle", () => {
					log.push("first");
				});
			});
			app.state("Draft", (s) => {
				s.on("SetTitle", () => {
					log.push("second");
				});
			});
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
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
			app.state("Draft", (state) => {
				state.use(async (_ctx, next) => {
					log.push("state-before");
					await next();
					log.push("state-after");
				});
				state.on(
					"SetTitle",
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
			await app.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
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
			app.state("Draft", (state) => {
				state.on("SetTitle", async (ctx) => {
					await new Promise((resolve) => setTimeout(resolve, 1));
					ctx.update({ title: ctx.command.payload.title });
				});
			});
			const result = await app.dispatch(wf.Draft(), {
				type: "SetTitle",
				payload: { title: "async-title" },
			});
			expect(result.ok).toBe(true);
			if (result.ok && result.workflow.state === "Draft") {
				expect(result.workflow.data.title).toBe("async-title");
			}
		});
	});
});
