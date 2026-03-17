import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "../src/index.js";

describe("WorkflowRouter.definition", () => {
	test("exposes the definition as a public readonly property", () => {
		const definition = defineWorkflow("test", {
			states: { Idle: z.object({ value: z.number() }) },
			commands: { Inc: z.object({}) },
			events: {},
			errors: {},
		});
		const router = new WorkflowRouter(definition);

		expect(router.definition).toBe(definition);
		expect(router.definition.name).toBe("test");
	});
});
