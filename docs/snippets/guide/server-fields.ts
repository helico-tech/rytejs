import type { ClientStateData } from "@rytejs/core";
import { defineWorkflow, state } from "@rytejs/core";
import { z } from "zod";

// ── Loan workflow with server-only fields ───────────────────────────────────

// #region marking
const loanDef = defineWorkflow("loan", {
	states: {
		Review: state({
			schema: z.object({
				applicantName: z.string(),
				ssn: z.string(),
				creditScore: z.number(),
			}),
			clientSchema: z.object({
				applicantName: z.string(),
			}),
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
// #endregion marking

// ── Serialize vs serializeForClient ─────────────────────────────────────────

// #region serialize
const wf = loanDef.createWorkflow("loan-1", {
	initialState: "Review",
	data: { applicantName: "Alice", ssn: "123-45-6789", creditScore: 780 },
});

// Full snapshot — for server-side persistence
const _full = loanDef.serialize(wf);
// full.data = { applicantName: "Alice", ssn: "123-45-6789", creditScore: 780 }

// Client snapshot — data passes through the client schema; unknown keys are stripped
const client = loanDef.serializeForClient(wf);
// client.data = { applicantName: "Alice" }
// #endregion serialize

// ── Client definition ───────────────────────────────────────────────────────

// #region client-definition
const clientDef = loanDef.forClient();

// Re-validates against the declared clientSchema for defence-in-depth
const result = clientDef.deserialize(client);
if (result.ok) {
	result.workflow.state; // "Review"
	result.workflow.data; // { applicantName: "Alice" }
}

// Same instance on repeated calls
loanDef.forClient() === clientDef; // true
// #endregion client-definition

// ── Type safety ─────────────────────────────────────────────────────────────

// #region type-safety
type LoanConfig = typeof loanDef.config;

// Server-side: full data type
// StateData<LoanConfig, "Review"> = { applicantName: string, ssn: string, creditScore: number }

// Client-side: the clientSchema's inferred output
type ReviewClient = ClientStateData<LoanConfig, "Review">;
// { applicantName: string }

const data: ReviewClient = { applicantName: "Alice" };
data.applicantName; // ✅ string

// @ts-expect-error — ssn is only in the server schema
data.ssn;

// @ts-expect-error — creditScore is only in the server schema
data.creditScore;
// #endregion type-safety
