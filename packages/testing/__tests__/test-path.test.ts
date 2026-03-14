import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { testPath } from "../src/test-path.js";

const definition = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
	},
	events: {},
	errors: {},
});

function setupRouter() {
	const router = new WorkflowRouter(definition);
	router.state("Todo", (state) => {
		state.on("Start", (ctx) => {
			ctx.transition("InProgress", {
				title: ctx.data.title,
				assignee: ctx.command.payload.assignee,
			});
		});
	});
	router.state("InProgress", (state) => {
		state.on("Complete", (ctx) => {
			ctx.transition("Done", {
				title: ctx.data.title,
				completedAt: new Date(),
			});
		});
	});
	return router;
}

describe("testPath", () => {
	test("verifies a full state transition path", async () => {
		const router = setupRouter();
		await testPath(router, definition, [
			{
				start: "Todo",
				data: { title: "Fix bug" },
				command: "Start",
				payload: { assignee: "alice" },
				expect: "InProgress",
			},
			{ command: "Complete", payload: {}, expect: "Done" },
		]);
	});

	test("throws when a step transitions to wrong state", async () => {
		const router = setupRouter();
		await expect(
			testPath(router, definition, [
				{
					start: "Todo",
					data: { title: "Fix bug" },
					command: "Start",
					payload: { assignee: "alice" },
					expect: "Done",
				},
			]),
		).rejects.toThrow("Expected state 'Done'");
	});

	test("throws when a step dispatch fails", async () => {
		const router = setupRouter();
		await expect(
			testPath(router, definition, [
				{
					start: "Todo",
					data: { title: "Fix bug" },
					command: "Complete",
					payload: {},
					expect: "Done",
				},
			]),
		).rejects.toThrow();
	});
});
