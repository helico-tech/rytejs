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
		draft: z.object({ title: z.string() }),
		published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		create: z.object({ title: z.string() }),
		publish: z.object({}),
	},
	events: {
		Created: z.object({ id: z.string() }),
		Published: z.object({ id: z.string() }),
	},
	errors: {
		alreadyPublished: z.object({}),
		invalidTitle: z.object({ reason: z.string() }),
	},
} as const satisfies WorkflowConfig;

type TestConfig = typeof testConfig;

describe("Type utilities", () => {
	test("StateNames extracts state keys", () => {
		type Result = StateNames<TestConfig>;
		const value: Result = "draft";
		expect(value).toBe("draft");
		const value2: Result = "published";
		expect(value2).toBe("published");
	});

	test("CommandNames extracts command keys", () => {
		type Result = CommandNames<TestConfig>;
		const value: Result = "create";
		expect(value).toBe("create");
	});

	test("EventNames extracts event keys", () => {
		type Result = EventNames<TestConfig>;
		const value: Result = "Created";
		expect(value).toBe("Created");
	});

	test("ErrorCodes extracts error keys", () => {
		type Result = ErrorCodes<TestConfig>;
		const value: Result = "alreadyPublished";
		expect(value).toBe("alreadyPublished");
	});

	test("StateData resolves to Zod inferred type", () => {
		type Result = StateData<TestConfig, "draft">;
		const value: Result = { title: "hello" };
		expect(value.title).toBe("hello");
	});

	test("CommandPayload resolves to Zod inferred type", () => {
		type Result = CommandPayload<TestConfig, "create">;
		const value: Result = { title: "hello" };
		expect(value.title).toBe("hello");
	});

	test("EventData resolves to Zod inferred type", () => {
		type Result = EventData<TestConfig, "Created">;
		const value: Result = { id: "123" };
		expect(value.id).toBe("123");
	});

	test("ErrorData resolves to Zod inferred type", () => {
		type Result = ErrorData<TestConfig, "invalidTitle">;
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
		const err = new DomainErrorSignal("alreadyPublished", {});
		expect(err.code).toBe("alreadyPublished");
		expect(err.data).toEqual({});
		expect(err).toBeInstanceOf(Error);
	});
});
