import { defineWorkflow } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestWorkflow } from "../src/create-test-workflow.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Shipped: z.object({ items: z.array(z.string()), trackingId: z.string() }),
	},
	commands: { PlaceOrder: z.object({}) },
	events: {},
	errors: {},
});

describe("createTestWorkflow", () => {
	test("creates a workflow in the specified state", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: ["apple"] });
		expect(wf.state).toBe("Draft");
		expect(wf.data).toEqual({ items: ["apple"] });
	});

	test("creates a workflow with a generated id", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: [] });
		expect(typeof wf.id).toBe("string");
		expect(wf.id.length).toBeGreaterThan(0);
	});

	test("creates a workflow with custom id via options", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: [] }, { id: "custom-id" });
		expect(wf.id).toBe("custom-id");
	});

	test("validates data against state schema", () => {
		expect(() => createTestWorkflow(definition, "Draft", { items: "not-array" as any })).toThrow();
	});

	test("sets definitionName from the definition", () => {
		const wf = createTestWorkflow(definition, "Placed", {
			items: ["a"],
			placedAt: new Date(),
		});
		expect(wf.definitionName).toBe("order");
	});

	test("sets createdAt and updatedAt", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: [] });
		expect(wf.createdAt).toBeInstanceOf(Date);
		expect(wf.updatedAt).toBeInstanceOf(Date);
	});
});
