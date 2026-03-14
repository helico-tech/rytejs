import { describe, expect, test } from "vitest";
import { z } from "zod";
import type {
	CommandNames,
	CommandPayload,
	ErrorCodes,
	ErrorData,
	EventData,
	EventNames,
	StateData,
	StateNames,
	WorkflowConfig,
} from "../src/types.js";
import { DomainErrorSignal, ValidationError } from "../src/types.js";

const testConfig = {
	states: {
		Draft: z.object({ title: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		Create: z.object({ title: z.string() }),
		Publish: z.object({}),
	},
	events: {
		Created: z.object({ id: z.string() }),
		Published: z.object({ id: z.string() }),
	},
	errors: {
		AlreadyPublished: z.object({}),
		InvalidTitle: z.object({ reason: z.string() }),
	},
} as const satisfies WorkflowConfig;

type TestConfig = typeof testConfig;

describe("Type utilities", () => {
	test("StateNames extracts state keys", () => {
		type Result = StateNames<TestConfig>;
		const value: Result = "Draft";
		expect(value).toBe("Draft");
		const value2: Result = "Published";
		expect(value2).toBe("Published");
	});

	test("CommandNames extracts command keys", () => {
		type Result = CommandNames<TestConfig>;
		const value: Result = "Create";
		expect(value).toBe("Create");
	});

	test("EventNames extracts event keys", () => {
		type Result = EventNames<TestConfig>;
		const value: Result = "Created";
		expect(value).toBe("Created");
	});

	test("ErrorCodes extracts error keys", () => {
		type Result = ErrorCodes<TestConfig>;
		const value: Result = "AlreadyPublished";
		expect(value).toBe("AlreadyPublished");
	});

	test("StateData resolves to Zod inferred type", () => {
		type Result = StateData<TestConfig, "Draft">;
		const value: Result = { title: "hello" };
		expect(value.title).toBe("hello");
	});

	test("CommandPayload resolves to Zod inferred type", () => {
		type Result = CommandPayload<TestConfig, "Create">;
		const value: Result = { title: "hello" };
		expect(value.title).toBe("hello");
	});

	test("EventData resolves to Zod inferred type", () => {
		type Result = EventData<TestConfig, "Created">;
		const value: Result = { id: "123" };
		expect(value.id).toBe("123");
	});

	test("ErrorData resolves to Zod inferred type", () => {
		type Result = ErrorData<TestConfig, "InvalidTitle">;
		const value: Result = { reason: "too short" };
		expect(value.reason).toBe("too short");
	});
});

describe("Error classes", () => {
	test("ValidationError carries source and issues", () => {
		const schema = z.object({ title: z.string() });
		const result = schema.safeParse({ title: 123 });
		expect(result.success).toBe(false);
		if (result.success) throw new Error();

		const err = new ValidationError("command", result.error.issues);
		expect(err.source).toBe("command");
		expect(err.issues.length).toBeGreaterThan(0);
		expect(err).toBeInstanceOf(Error);
	});

	test("DomainErrorSignal carries code and data", () => {
		const err = new DomainErrorSignal("AlreadyPublished", {});
		expect(err.code).toBe("AlreadyPublished");
		expect(err.data).toEqual({});
		expect(err).toBeInstanceOf(Error);
	});
});
