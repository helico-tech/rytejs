import { describe, expect, test } from "vitest";
import { z } from "zod";
import { isServerField, server, stripServerData } from "../src/server.js";

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

describe("stripServerData()", () => {
	test("strips top-level server fields", () => {
		const schema = z.object({
			name: z.string(),
			ssn: server(z.string()),
		});
		const data = { name: "Alice", ssn: "123-45-6789" };
		expect(stripServerData(schema, data)).toEqual({ name: "Alice" });
	});

	test("strips nested server fields", () => {
		const schema = z.object({
			applicant: z.object({
				name: z.string(),
				ssn: server(z.string()),
			}),
			total: z.number(),
		});
		const data = { applicant: { name: "Alice", ssn: "123-45-6789" }, total: 100 };
		expect(stripServerData(schema, data)).toEqual({
			applicant: { name: "Alice" },
			total: 100,
		});
	});

	test("returns identical data when no server fields", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});
		const data = { name: "Alice", age: 30 };
		expect(stripServerData(schema, data)).toEqual({ name: "Alice", age: 30 });
	});

	test("returns empty object when all fields are server-only", () => {
		const schema = z.object({
			ssn: server(z.string()),
			secret: server(z.number()),
		});
		const data = { ssn: "123-45-6789", secret: 42 };
		expect(stripServerData(schema, data)).toEqual({});
	});
});
