import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { expectError, expectOk } from "../src/assertions.js";

const definition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
		Fail: z.object({}),
	},
	events: {},
	errors: {
		NotAllowed: z.object({ reason: z.string() }),
	},
});

function setupRouter() {
	const router = new WorkflowRouter(definition);
	router.state("Draft", (state) => {
		state.on("Publish", (ctx) => {
			ctx.transition("Published", { title: ctx.command.payload.title });
		});
		state.on("Fail", (ctx) => {
			ctx.error({ code: "NotAllowed", data: { reason: "test" } });
		});
	});
	return router;
}

describe("expectOk", () => {
	test("passes on ok result", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expectOk(result);
	});

	test("throws on error result", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expect(() => expectOk(result)).toThrow("Expected ok result");
	});

	test("checks specific state when provided", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expectOk(result, "Published");
	});

	test("throws when state does not match", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expect(() => expectOk(result, "Draft")).toThrow("Expected state 'Draft' but got 'Published'");
	});
});

describe("expectError", () => {
	test("passes on error result with matching category", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expectError(result, "domain");
	});

	test("throws on ok result", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expect(() => expectError(result, "domain")).toThrow("Expected error result");
	});

	test("checks specific error code when provided", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expectError(result, "domain", "NotAllowed");
	});

	test("throws when error code does not match", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expect(() => expectError(result, "domain", "WrongCode" as any)).toThrow(
			"Expected error code 'WrongCode'",
		);
	});

	test("throws when category does not match", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expect(() => expectError(result, "validation")).toThrow("Expected error category 'validation'");
	});
});
