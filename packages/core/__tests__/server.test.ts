import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, state } from "../src/index.js";
import type { ClientStateData } from "../src/types.js";

describe("state() — server field declaration", () => {
	test("returns a state config carrying schema + server keys", () => {
		const schema = z.object({ name: z.string(), ssn: z.string() });
		const cfg = state({ schema, server: ["ssn"] });
		expect(cfg.schema).toBe(schema);
		expect(cfg.server).toEqual(["ssn"]);
	});

	test("server keys default to undefined when not provided", () => {
		const cfg = state({ schema: z.object({ name: z.string() }) });
		expect(cfg.server).toBeUndefined();
	});
});

describe("serializeForClient()", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: state({
				schema: z.object({
					applicantName: z.string(),
					ssn: z.string(),
					internalScore: z.number(),
				}),
				server: ["ssn", "internalScore"],
			}),
			Approved: state({
				schema: z.object({
					applicantName: z.string(),
					approvedAmount: z.number(),
					underwriterNotes: z.string(),
				}),
				server: ["underwriterNotes"],
			}),
		},
		commands: { Approve: z.object({ amount: z.number() }) },
		events: { LoanApproved: z.object({ loanId: z.string() }) },
		errors: { CreditCheckFailed: z.object({ reason: z.string() }) },
	});

	test("strips declared server fields from snapshot data", () => {
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
		expect(clientSnapshot.data).toEqual({ applicantName: "Alice" });
	});

	test("preserves all non-data snapshot fields", () => {
		const wf = loanDef.createWorkflow("loan-1", {
			initialState: "Review",
			data: { applicantName: "Alice", ssn: "123", internalScore: 0 },
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

	test("returns same data as serialize() when no server fields declared", () => {
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
			Review: state({
				schema: z.object({
					applicantName: z.string(),
					ssn: z.string(),
					internalScore: z.number(),
				}),
				server: ["ssn", "internalScore"],
			}),
			Approved: state({
				schema: z.object({
					applicantName: z.string(),
					approvedAmount: z.number(),
				}),
			}),
		},
		commands: { Approve: z.object({ amount: z.number() }) },
		events: { LoanApproved: z.object({ loanId: z.string() }) },
		errors: { CreditCheckFailed: z.object({ reason: z.string() }) },
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

	test("deserialize() constructs a workflow from a trusted client snapshot", () => {
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

	test("deserialize() does NOT re-validate data shape", () => {
		// Snapshots from the trusted server are accepted as-is — this is the
		// explicit semantic of the validator-agnostic client projection.
		// Defence-in-depth is the caller's responsibility.
		const clientDef = loanDef.forClient();
		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "Review",
			data: { applicantName: 42, extra: "surprise" } as unknown as { applicantName: string },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});
		expect(result.ok).toBe(true);
	});
});

describe("client types", () => {
	const _loanDef = defineWorkflow("loan", {
		states: {
			Review: state({
				schema: z.object({
					applicantName: z.string(),
					ssn: z.string(),
					internalScore: z.number(),
				}),
				server: ["ssn", "internalScore"],
			}),
			Approved: z.object({
				applicantName: z.string(),
				approvedAmount: z.number(),
			}),
		},
		commands: { Approve: z.object({ amount: z.number() }) },
		events: { LoanApproved: z.object({ loanId: z.string() }) },
		errors: { CreditCheckFailed: z.object({ reason: z.string() }) },
	});

	type LoanConfig = typeof _loanDef.config;

	test("ClientStateData excludes declared server fields", () => {
		type ReviewClient = ClientStateData<LoanConfig, "Review">;

		const valid: ReviewClient = { applicantName: "Alice" };
		expect(valid.applicantName).toBe("Alice");

		// @ts-expect-error — ssn should not exist on client type
		const _ssn: ReviewClient = { applicantName: "Alice", ssn: "123" };

		// @ts-expect-error — internalScore should not exist on client type
		const _score: ReviewClient = { applicantName: "Alice", internalScore: 95 };
	});

	test("ClientStateData preserves all fields for plain-schema states", () => {
		type ApprovedClient = ClientStateData<LoanConfig, "Approved">;
		const valid: ApprovedClient = { applicantName: "Bob", approvedAmount: 50000 };
		expect(valid.approvedAmount).toBe(50000);
	});
});
