import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { createWorkflowContext, createWorkflowStore } from "@rytejs/react";
import { z } from "zod";

// --- Item schema ---

const itemSchema = z.object({
	name: z.string(),
	quantity: z.number().int().positive(),
	price: z.number().positive(),
});

export type Item = z.infer<typeof itemSchema>;

// --- Workflow definition ---

const orderDefinition = defineWorkflow("order", {
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

// --- Router with handlers ---

const router = new WorkflowRouter(orderDefinition);

// Draft state: add/remove items, set customer, submit
router.state("Draft", ({ on }) => {
	on("AddItem", ({ data, command, update }) => {
		const newItem: Item = {
			name: command.payload.name,
			quantity: command.payload.quantity,
			price: command.payload.price,
		};
		update({ items: [...data.items, newItem] });
	});

	on("RemoveItem", ({ data, command, update }) => {
		const items = data.items.filter((_, i) => i !== command.payload.index);
		update({ items });
	});

	on("SetCustomer", ({ command, update }) => {
		update({ customer: command.payload.customer });
	});

	on("Submit", ({ data, workflow, transition, emit, error }) => {
		if (data.items.length === 0) {
			error({ code: "EmptyOrder", data: {} });
		}
		const now = new Date();
		transition("Submitted", {
			customer: data.customer,
			items: data.items,
			submittedAt: now,
		});
		emit({
			type: "OrderSubmitted",
			data: { orderId: workflow.id, customer: data.customer, itemCount: data.items.length },
		});
	});
});

// Submitted state: approve or reject
router.state("Submitted", ({ on }) => {
	on("Approve", ({ data, workflow, command, transition, emit }) => {
		transition("Approved", {
			customer: data.customer,
			items: data.items,
			approvedBy: command.payload.approvedBy,
		});
		emit({
			type: "OrderApproved",
			data: { orderId: workflow.id, approvedBy: command.payload.approvedBy },
		});
	});

	on("Reject", ({ data, workflow, command, transition, emit }) => {
		transition("Rejected", {
			customer: data.customer,
			items: data.items,
			reason: command.payload.reason,
			rejectedAt: new Date(),
		});
		emit({
			type: "OrderRejected",
			data: { orderId: workflow.id, reason: command.payload.reason },
		});
	});
});

// Approved state: process payment
router.state("Approved", ({ on }) => {
	on("ProcessPayment", ({ data, workflow, command, transition, emit }) => {
		const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		transition("Paid", {
			customer: data.customer,
			items: data.items,
			paidAt: new Date(),
			transactionId: command.payload.transactionId,
		});
		emit({
			type: "PaymentProcessed",
			data: { orderId: workflow.id, transactionId: command.payload.transactionId, amount: total },
		});
	});
});

// Paid state: ship
router.state("Paid", ({ on }) => {
	on("Ship", ({ data, workflow, command, transition, emit }) => {
		transition("Shipped", {
			customer: data.customer,
			items: data.items,
			trackingNumber: command.payload.trackingNumber,
			shippedAt: new Date(),
		});
		emit({
			type: "OrderShipped",
			data: { orderId: workflow.id, trackingNumber: command.payload.trackingNumber },
		});
	});
});

// Shipped state: confirm delivery
router.state("Shipped", ({ on }) => {
	on("ConfirmDelivery", ({ data, workflow, transition, emit }) => {
		transition("Delivered", {
			customer: data.customer,
			items: data.items,
			deliveredAt: new Date(),
		});
		emit({
			type: "OrderDelivered",
			data: { orderId: workflow.id },
		});
	});
});

// Rejected state: resubmit back to Draft
router.state("Rejected", ({ on }) => {
	on("Resubmit", ({ data, transition }) => {
		transition("Draft", {
			customer: data.customer,
			items: data.items,
		});
	});
});

// --- Context factory ---

export const OrderContext = createWorkflowContext(orderDefinition);

// --- Store factory ---

export function createOrderStore() {
	return createWorkflowStore(
		router,
		{
			state: "Draft" as const,
			data: { customer: "", items: [] },
		},
		{
			persist: {
				key: "order-dashboard",
				storage: localStorage,
			},
		},
	);
}
