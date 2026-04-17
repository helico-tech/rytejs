import { defineGroup, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region define-group
// Shared base fields — expressed as a plain object and spread into each child
// schema. `defineGroup` itself does no schema merging, so the same pattern
// works with Valibot or ArkType instead of Zod.
const basePayment = { amount: z.number(), currency: z.string() };

const Payment = defineGroup("Payment", {
	Pending: z.object({ ...basePayment, attempt: z.number() }),
	Failed: z.object({ ...basePayment, reason: z.string() }),
	Retrying: z.object({ ...basePayment, attempt: z.number(), nextRetryAt: z.date() }),
});
// #endregion define-group

// #region spread-into-config
const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		...Payment.states,
		Shipped: z.object({ trackingId: z.string() }),
	},
	commands: {
		RetryPayment: z.object({}),
		CancelPayment: z.object({}),
		FailPayment: z.object({ reason: z.string() }),
	},
	events: {},
	errors: {},
});
// #endregion spread-into-config

const router = new WorkflowRouter(orderWorkflow);

// #region sub-state-handler
router.state(Payment.Pending, ({ on }) => {
	on("RetryPayment", ({ data, transition }) => {
		// data: { amount: number, currency: string, attempt: number }
		transition("Payment.Retrying", {
			amount: data.amount,
			currency: data.currency,
			attempt: data.attempt + 1,
			nextRetryAt: new Date(Date.now() + 60_000),
		});
	});
});
// #endregion sub-state-handler

// #region group-handler
router.state(Payment.names, ({ on }) => {
	on("CancelPayment", ({ data, match, transition }) => {
		// data shared fields are accessible directly: data.amount, data.currency
		// child-specific fields require match() to narrow:
		const reason = match(
			{
				"Payment.Pending": (d) => `cancel at attempt ${d.attempt}`,
				"Payment.Failed": (d) => `cancel after failure: ${d.reason}`,
				"Payment.Retrying": (d) => `cancel retry at attempt ${d.attempt}`,
			},
			() => "unknown",
		);
		console.log(`Cancelled ${data.amount} ${data.currency}: ${reason}`);
		transition("Draft", { items: [] });
	});
});
// #endregion group-handler
