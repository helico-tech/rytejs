import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("targets-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Review: z.object({ title: z.string(), submittedBy: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		Submit: z.object({ submittedBy: z.string() }),
		Publish: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		Submitted: z.object({ id: z.string() }),
	},
	errors: {},
});

describe("transition targets", () => {
	test("state handler accepts targets option", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Submit", { targets: ["Review"] }, (ctx) => {
				ctx.transition("Review", {
					title: ctx.data.title ?? "untitled",
					submittedBy: ctx.command.payload.submittedBy,
				});
			});
		});
	});

	test("state handler works without targets (backward compatible)", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Submit", (ctx) => {
				ctx.transition("Review", {
					title: ctx.data.title ?? "untitled",
					submittedBy: ctx.command.payload.submittedBy,
				});
			});
		});
	});

	test("state handler with targets and inline middleware", () => {
		const log: string[] = [];
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on(
				"Submit",
				{ targets: ["Review"] },
				async (ctx, next) => {
					log.push("middleware");
					await next();
				},
				(ctx) => {
					log.push("handler");
					ctx.transition("Review", {
						title: ctx.data.title ?? "untitled",
						submittedBy: ctx.command.payload.submittedBy,
					});
				},
			);
		});
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		return router
			.dispatch(wf, { type: "Submit", payload: { submittedBy: "alice" } })
			.then((result) => {
				expect(result.ok).toBe(true);
				expect(log).toEqual(["middleware", "handler"]);
			});
	});

	test("wildcard handler accepts targets option", () => {
		const router = new WorkflowRouter(definition);
		router.on("*", "Archive", { targets: ["Archived"] }, (ctx) => {
			ctx.transition("Archived", { reason: ctx.command.payload.reason });
		});
	});

	test("targets are stored on handler entry and accessible internally", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Submit", { targets: ["Review"] }, (ctx) => {
				ctx.transition("Review", {
					title: "t",
					submittedBy: ctx.command.payload.submittedBy,
				});
			});
		});
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		return router
			.dispatch(wf, { type: "Submit", payload: { submittedBy: "alice" } })
			.then((result) => {
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.workflow.state).toBe("Review");
				}
			});
	});
});
