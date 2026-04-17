import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, state } from "../src/index.js";
import type { ClientStateData } from "../src/types.js";

describe("state() — schema + optional clientSchema", () => {
	test("returns a state config carrying both schemas", () => {
		const schema = z.object({ name: z.string(), ssn: z.string() });
		const clientSchema = z.object({ name: z.string() });
		const cfg = state({ schema, clientSchema });
		expect(cfg.schema).toBe(schema);
		expect(cfg.clientSchema).toBe(clientSchema);
	});

	test("clientSchema defaults to undefined when not provided", () => {
		const cfg = state({ schema: z.object({ name: z.string() }) });
		expect(cfg.clientSchema).toBeUndefined();
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
				clientSchema: z.object({ applicantName: z.string() }),
			}),
			Approved: state({
				schema: z.object({
					applicantName: z.string(),
					approvedAmount: z.number(),
					underwriterNotes: z.string(),
				}),
				clientSchema: z.object({
					applicantName: z.string(),
					approvedAmount: z.number(),
				}),
			}),
		},
		commands: { Approve: z.object({ amount: z.number() }) },
		events: { LoanApproved: z.object({ loanId: z.string() }) },
		errors: { CreditCheckFailed: z.object({ reason: z.string() }) },
	});

	test("strips fields absent from clientSchema (via validator default strip)", () => {
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

	test("uses per-state clientSchema", () => {
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

	test("returns same data as serialize() when no clientSchema declared", () => {
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

	test("throws if server data doesn't conform to clientSchema", () => {
		const badDef = defineWorkflow("bad", {
			states: {
				S: state({
					schema: z.object({ a: z.string() }),
					clientSchema: z.object({ a: z.string(), b: z.string() }),
				}),
			},
			commands: { C: z.object({}) },
			events: {},
			errors: {},
		});
		const wf = badDef.createWorkflow("b", { initialState: "S", data: { a: "hi" } });
		expect(() => badDef.serializeForClient(wf)).toThrow(/clientSchema validation/);
	});
});

describe("forClient()", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: state({
				schema: z.object({
					applicantName: z.string(),
					ssn: z.string(),
				}),
				clientSchema: z.object({ applicantName: z.string() }),
			}),
			Approved: state({
				schema: z.object({
					applicantName: z.string(),
					approvedAmount: z.number(),
				}),
				// No clientSchema — full shape visible to client
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

	test("deserialize() validates client snapshot against clientSchema", () => {
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

	test("deserialize() rejects snapshot data that fails clientSchema", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "Review",
			// Missing applicantName, and ssn is a server-only field (not in clientSchema).
			data: { ssn: "leaked" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(false);
	});

	test("deserialize() passes through data when no clientSchema declared", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-2",
			definitionName: "loan",
			state: "Approved",
			data: { applicantName: "Bob", approvedAmount: 50000 },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.data).toEqual({
				applicantName: "Bob",
				approvedAmount: 50000,
			});
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
				clientSchema: z.object({ applicantName: z.string() }),
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

	test("ClientStateData narrows to clientSchema output when declared", () => {
		type ReviewClient = ClientStateData<LoanConfig, "Review">;

		const valid: ReviewClient = { applicantName: "Alice" };
		expect(valid.applicantName).toBe("Alice");

		// @ts-expect-error — ssn is only in the server schema
		const _ssn: ReviewClient = { applicantName: "Alice", ssn: "123" };

		// @ts-expect-error — internalScore is only in the server schema
		const _score: ReviewClient = { applicantName: "Alice", internalScore: 95 };
	});

	test("ClientStateData equals StateData when no clientSchema declared (plain schema)", () => {
		type ApprovedClient = ClientStateData<LoanConfig, "Approved">;
		const valid: ApprovedClient = { applicantName: "Bob", approvedAmount: 50000 };
		expect(valid.approvedAmount).toBe(50000);
	});
});
