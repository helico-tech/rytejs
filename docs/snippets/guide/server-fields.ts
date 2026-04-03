import type { ClientStateData } from "@rytejs/core";
import { defineWorkflow, server } from "@rytejs/core";
import { z } from "zod";

// ── Loan workflow with server-only fields ───────────────────────────────────

// #region marking
const loanDef = defineWorkflow("loan", {
	states: {
		Review: z.object({
			applicantName: z.string(),
			ssn: server(z.string()),
			creditScore: server(z.number()),
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
// #endregion marking

// ── Serialize vs serializeForClient ─────────────────────────────────────────

// #region serialize
const wf = loanDef.createWorkflow("loan-1", {
	initialState: "Review",
	data: { applicantName: "Alice", ssn: "123-45-6789", creditScore: 780 },
});

// Full snapshot — for server-side persistence
const full = loanDef.serialize(wf);
// full.data = { applicantName: "Alice", ssn: "123-45-6789", creditScore: 780 }

// Client snapshot — server fields stripped
const client = loanDef.serializeForClient(wf);
// client.data = { applicantName: "Alice" }
// #endregion serialize

// ── Client definition ───────────────────────────────────────────────────────

// #region client-definition
const clientDef = loanDef.forClient();

// Client schemas have server fields removed
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

// Client-side: server fields excluded
type ReviewClient = ClientStateData<LoanConfig, "Review">;
// { applicantName: string }

const data: ReviewClient = { applicantName: "Alice" };
data.applicantName; // ✅ string

// @ts-expect-error — ssn does not exist on client type
data.ssn;

// @ts-expect-error — creditScore does not exist on client type
data.creditScore;
// #endregion type-safety
