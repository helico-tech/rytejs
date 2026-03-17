import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { createWorkflowContext } from "@rytejs/react";
import { z } from "zod";

// --- Item schema ---

export const itemSchema = z.object({
	name: z.string(),
	quantity: z.number().int().positive(),
	price: z.number().positive(),
});

export type Item = z.infer<typeof itemSchema>;

// --- Workflow definition (shared between server and client) ---

export const orderDefinition = defineWorkflow("order", {
	states: {
		Draft: z.object({ customer: z.string(), items: z.array(itemSchema) }),
		Submitted: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			submittedAt: z.coerce.date(),
		}),
		Approved: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			approvedBy: z.string(),
		}),
		Paid: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			paidAt: z.coerce.date(),
			transactionId: z.string(),
		}),
		Shipped: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			trackingNumber: z.string(),
			shippedAt: z.coerce.date(),
		}),
		Delivered: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			deliveredAt: z.coerce.date(),
		}),
		Rejected: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			reason: z.string(),
			rejectedAt: z.coerce.date(),
		}),
	},
	commands: {
		AddItem: z.object({
			name: z.string(),
			quantity: z.number().int().positive(),
			price: z.number().positive(),
		}),
		RemoveItem: z.object({ index: z.number().int().min(0) }),
		SetCustomer: z.object({ customer: z.string() }),
		Submit: z.object({}),
		Approve: z.object({ approvedBy: z.string() }),
		Reject: z.object({ reason: z.string() }),
		ProcessPayment: z.object({ transactionId: z.string() }),
		Ship: z.object({ trackingNumber: z.string() }),
		ConfirmDelivery: z.object({}),
		Resubmit: z.object({}),
	},
	events: {
		OrderSubmitted: z.object({ orderId: z.string(), customer: z.string(), itemCount: z.number() }),
		OrderApproved: z.object({ orderId: z.string(), approvedBy: z.string() }),
		OrderRejected: z.object({ orderId: z.string(), reason: z.string() }),
		PaymentProcessed: z.object({
			orderId: z.string(),
			transactionId: z.string(),
			amount: z.number(),
		}),
		OrderShipped: z.object({ orderId: z.string(), trackingNumber: z.string() }),
		OrderDelivered: z.object({ orderId: z.string() }),
	},
	errors: {
		EmptyOrder: z.object({}),
	},
});

export type OrderConfig = typeof orderDefinition.config;

// Client-side router — no handlers needed for server-authoritative dispatch.
// Only router.definition is used (for restore/snapshot).
export const clientRouter = new WorkflowRouter(orderDefinition);

export const OrderContext = createWorkflowContext(orderDefinition);
