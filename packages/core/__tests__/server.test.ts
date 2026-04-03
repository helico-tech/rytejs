import { describe, expect, test } from "vitest";
import { z } from "zod";
import { isServerField, server } from "../src/server.js";

describe("server()", () => {
	test("marks a schema as server-only", () => {
		const schema = server(z.string());
		expect(isServerField(schema)).toBe(true);
	});

	test("unmarked schemas are not server-only", () => {
		const schema = z.string();
		expect(isServerField(schema)).toBe(false);
	});

	test("preserves Zod validation behavior", () => {
		const schema = server(z.string().min(3));
		expect(schema.safeParse("hello").success).toBe(true);
		expect(schema.safeParse("hi").success).toBe(false);
		expect(schema.safeParse(123).success).toBe(false);
	});

	test("works with complex schemas", () => {
		const schema = server(z.object({ a: z.number(), b: z.string() }));
		expect(isServerField(schema)).toBe(true);
		expect(schema.safeParse({ a: 1, b: "x" }).success).toBe(true);
	});
});
