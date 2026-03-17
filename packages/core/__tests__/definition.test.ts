import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";

const testDefinition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		Create: z.object({ title: z.string() }),
		Publish: z.object({}),
	},
	events: {
		Created: z.object({ id: z.string() }),
	},
	errors: {
		InvalidTitle: z.object({ reason: z.string() }),
	},
});

describe("defineWorkflow", () => {
	test("returns definition with name", () => {
		expect(testDefinition.name).toBe("test");
	});

	test("exposes config", () => {
		expect(testDefinition.config.states).toBeDefined();
		expect(testDefinition.config.commands).toBeDefined();
		expect(testDefinition.config.events).toBeDefined();
		expect(testDefinition.config.errors).toBeDefined();
	});

	test("getStateSchema returns the Zod schema for a state", () => {
		const schema = testDefinition.getStateSchema("Draft");
		const result = schema.safeParse({ title: "hello" });
		expect(result.success).toBe(true);
	});

	test("getStateSchema throws for unknown state", () => {
		expect(() => testDefinition.getStateSchema("nonexistent")).toThrow(
			"Unknown state: nonexistent",
		);
	});

	test("getCommandSchema returns the Zod schema for a command", () => {
		const schema = testDefinition.getCommandSchema("Create");
		const result = schema.safeParse({ title: "hello" });
		expect(result.success).toBe(true);
	});

	test("getCommandSchema throws for unknown command", () => {
		expect(() => testDefinition.getCommandSchema("nonexistent")).toThrow(
			"Unknown command: nonexistent",
		);
	});

	test("getEventSchema returns the Zod schema for an event", () => {
		const schema = testDefinition.getEventSchema("Created");
		const result = schema.safeParse({ id: "123" });
		expect(result.success).toBe(true);
	});

	test("getEventSchema throws for unknown event", () => {
		expect(() => testDefinition.getEventSchema("nonexistent")).toThrow(
			"Unknown event: nonexistent",
		);
	});

	test("getErrorSchema returns the Zod schema for an error code", () => {
		const schema = testDefinition.getErrorSchema("InvalidTitle");
		const result = schema.safeParse({ reason: "too short" });
		expect(result.success).toBe(true);
	});

	test("getErrorSchema throws for unknown error code", () => {
		expect(() => testDefinition.getErrorSchema("nonexistent")).toThrow(
			"Unknown error: nonexistent",
		);
	});

	test("hasState returns true for known states", () => {
		expect(testDefinition.hasState("Draft")).toBe(true);
		expect(testDefinition.hasState("nonexistent")).toBe(false);
	});

	test("hasCommand returns true for known commands", () => {
		expect(testDefinition.hasCommand("Create")).toBe(true);
		expect(testDefinition.hasCommand("Publish")).toBe(true);
		expect(testDefinition.hasCommand("nonexistent")).toBe(false);
	});

	test("hasEvent returns true for known events", () => {
		expect(testDefinition.hasEvent("Created")).toBe(true);
		expect(testDefinition.hasEvent("nonexistent")).toBe(false);
	});
});

describe("createWorkflow", () => {
	test("creates workflow with initial state and data", () => {
		const wf = testDefinition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { title: "hello" },
		});

		expect(wf.id).toBe("wf-1");
		expect(wf.definitionName).toBe("test");
		expect(wf.state).toBe("Draft");
		expect(wf.data).toEqual({ title: "hello" });
		expect(wf.createdAt).toBeInstanceOf(Date);
		expect(wf.updatedAt).toBeInstanceOf(Date);
	});

	test("creates workflow with empty data when schema allows it", () => {
		const wf = testDefinition.createWorkflow("wf-2", {
			initialState: "Draft",
			data: {},
		});

		expect(wf.state).toBe("Draft");
		expect(wf.data).toEqual({});
	});

	test("throws validation error for invalid initial data", () => {
		expect(() =>
			testDefinition.createWorkflow("wf-3", {
				initialState: "Published",
				// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid data to test validation
				data: {} as any,
			}),
		).toThrow();
	});

	test("throws for unknown initial state", () => {
		expect(() =>
			testDefinition.createWorkflow("wf-4", {
				// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid state to test error
				initialState: "nonexistent" as any,
				data: {},
			}),
		).toThrow("Unknown state: nonexistent");
	});
});
