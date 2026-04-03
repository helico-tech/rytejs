import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { deriveClientSchema, isServerField, server, stripServerData } from "../src/server.js";

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

describe("deriveClientSchema()", () => {
	test("derives schema without server fields", () => {
		const schema = z.object({
			name: z.string(),
			ssn: server(z.string()),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({ name: "Alice" }).success).toBe(true);
		expect(clientSchema.safeParse({ name: "Alice", ssn: "123" }).success).toBe(false);
	});

	test("derives schema with nested server fields", () => {
		const schema = z.object({
			applicant: z.object({
				name: z.string(),
				ssn: server(z.string()),
			}),
			total: z.number(),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({ applicant: { name: "Alice" }, total: 100 }).success).toBe(true);
		expect(
			clientSchema.safeParse({ applicant: { name: "Alice", ssn: "123" }, total: 100 }).success,
		).toBe(false);
	});

	test("returns equivalent schema when no server fields", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
		expect(clientSchema.safeParse({ name: "Alice" }).success).toBe(false);
	});

	test("returns empty object schema when all fields are server-only", () => {
		const schema = z.object({
			ssn: server(z.string()),
			secret: server(z.number()),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({}).success).toBe(true);
		expect(clientSchema.safeParse({ ssn: "123" }).success).toBe(false);
	});
});

describe("serializeForClient()", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: z.object({
				applicantName: z.string(),
				ssn: server(z.string()),
				internalScore: server(z.number()),
			}),
			Approved: z.object({
				applicantName: z.string(),
				approvedAmount: z.number(),
				underwriterNotes: server(z.string()),
			}),
		},
		commands: {
			Approve: z.object({ amount: z.number() }),
		},
		events: {
			LoanApproved: z.object({ loanId: z.string() }),
		},
		errors: {
			CreditCheckFailed: z.object({ reason: z.string() }),
		},
	});

	test("strips server fields from snapshot data", () => {
		const wf = loanDef.createWorkflow("loan-1", {
			initialState: "Review",
			data: { applicantName: "Alice", ssn: "123-45-6789", internalScore: 95 },
		});

		const fullSnapshot = loanDef.serialize(wf);
		const clientSnapshot = loanDef.serializeForClient(wf);

		expect(fullSnapshot.data).toEqual({
			applicantName: "Alice",
			ssn: "123-45-6789",
			internalScore: 95,
		});
		expect(clientSnapshot.data).toEqual({
			applicantName: "Alice",
		});
	});

	test("preserves all non-data snapshot fields", () => {
		const wf = loanDef.createWorkflow("loan-1", {
			initialState: "Review",
			data: { applicantName: "Alice", ssn: "123-45-6789", internalScore: 95 },
		});

		const fullSnapshot = loanDef.serialize(wf);
		const clientSnapshot = loanDef.serializeForClient(wf);

		expect(clientSnapshot.id).toBe(fullSnapshot.id);
		expect(clientSnapshot.definitionName).toBe(fullSnapshot.definitionName);
		expect(clientSnapshot.state).toBe(fullSnapshot.state);
		expect(clientSnapshot.createdAt).toBe(fullSnapshot.createdAt);
		expect(clientSnapshot.updatedAt).toBe(fullSnapshot.updatedAt);
		expect(clientSnapshot.modelVersion).toBe(fullSnapshot.modelVersion);
		expect(clientSnapshot.version).toBe(fullSnapshot.version);
	});

	test("works with different states", () => {
		const wf = loanDef.createWorkflow("loan-2", {
			initialState: "Approved",
			data: { applicantName: "Bob", approvedAmount: 50000, underwriterNotes: "Good credit" },
		});

		const clientSnapshot = loanDef.serializeForClient(wf);
		expect(clientSnapshot.data).toEqual({
			applicantName: "Bob",
			approvedAmount: 50000,
		});
	});

	test("returns same data as serialize() when no server fields", () => {
		const simpleDef = defineWorkflow("simple", {
			states: { Active: z.object({ name: z.string() }) },
			commands: { DoThing: z.object({}) },
			events: { ThingDone: z.object({}) },
			errors: { Oops: z.object({}) },
		});
		const wf = simpleDef.createWorkflow("s-1", {
			initialState: "Active",
			data: { name: "test" },
		});

		const full = simpleDef.serialize(wf);
		const client = simpleDef.serializeForClient(wf);
		expect(client.data).toEqual(full.data);
	});
});

describe("forClient()", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: z.object({
				applicantName: z.string(),
				ssn: server(z.string()),
				internalScore: server(z.number()),
			}),
			Approved: z.object({
				applicantName: z.string(),
				approvedAmount: z.number(),
				underwriterNotes: server(z.string()),
			}),
		},
		commands: {
			Approve: z.object({ amount: z.number() }),
		},
		events: {
			LoanApproved: z.object({ loanId: z.string() }),
		},
		errors: {
			CreditCheckFailed: z.object({ reason: z.string() }),
		},
	});

	test("returns a client definition with name", () => {
		const clientDef = loanDef.forClient();
		expect(clientDef.name).toBe("loan");
	});

	test("is memoized — returns same instance", () => {
		const a = loanDef.forClient();
		const b = loanDef.forClient();
		expect(a).toBe(b);
	});

	test("hasState() works for all states", () => {
		const clientDef = loanDef.forClient();
		expect(clientDef.hasState("Review")).toBe(true);
		expect(clientDef.hasState("Approved")).toBe(true);
		expect(clientDef.hasState("NonExistent")).toBe(false);
	});

	test("getStateSchema() returns client schema without server fields", () => {
		const clientDef = loanDef.forClient();
		const reviewSchema = clientDef.getStateSchema("Review");

		expect(reviewSchema.safeParse({ applicantName: "Alice" }).success).toBe(true);
		expect(reviewSchema.safeParse({ applicantName: "Alice", ssn: "123" }).success).toBe(false);
	});

	test("deserialize() validates against client schema", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "Review",
			data: { applicantName: "Alice" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.state).toBe("Review");
			expect(result.workflow.data).toEqual({ applicantName: "Alice" });
		}
	});

	test("deserialize() rejects data with server fields", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "Review",
			data: { applicantName: "Alice", ssn: "123-45-6789" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(false);
	});

	test("deserialize() rejects unknown state", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "NonExistent",
			data: {},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(false);
	});
});
