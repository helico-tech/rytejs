/**
 * Order fulfillment workflow — demonstrates a non-trivial state machine
 * instrumented with the @rytejs/otel plugin.
 */

import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { createOtelPlugin } from "@rytejs/otel";
import { z } from "zod";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// 1. Workflow definition
// ---------------------------------------------------------------------------

const ItemSchema = z.object({
	sku: z.string(),
	name: z.string(),
	quantity: z.number().int().positive(),
	priceInCents: z.number().int().nonnegative(),
});

export const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({
			items: z.array(ItemSchema),
			customerEmail: z.string().email().optional(),
		}),
		Placed: z.object({
			items: z.array(ItemSchema),
			customerEmail: z.string().email(),
			placedAt: z.coerce.date(),
		}),
		Paid: z.object({
			items: z.array(ItemSchema),
			customerEmail: z.string().email(),
			placedAt: z.coerce.date(),
			paidAt: z.coerce.date(),
			transactionId: z.string(),
		}),
		Shipped: z.object({
			items: z.array(ItemSchema),
			customerEmail: z.string().email(),
			placedAt: z.coerce.date(),
			paidAt: z.coerce.date(),
			transactionId: z.string(),
			shippedAt: z.coerce.date(),
			trackingNumber: z.string(),
		}),
		Cancelled: z.object({
			items: z.array(ItemSchema),
			customerEmail: z.string().email().optional(),
			cancelledAt: z.coerce.date(),
			reason: z.string(),
		}),
	},

	commands: {
		Place: z.object({ customerEmail: z.string().email() }),
		Pay: z.object({ transactionId: z.string() }),
		Ship: z.object({ trackingNumber: z.string() }),
		Cancel: z.object({ reason: z.string() }),
	},

	events: {
		OrderPlaced: z.object({ orderId: z.string(), customerEmail: z.string() }),
		OrderPaid: z.object({ orderId: z.string(), transactionId: z.string() }),
		OrderShipped: z.object({ orderId: z.string(), trackingNumber: z.string() }),
		OrderCancelled: z.object({ orderId: z.string(), reason: z.string() }),
	},

	errors: {
		EmptyCart: z.object({}),
		AlreadyPaid: z.object({ transactionId: z.string() }),
	},
});

// ---------------------------------------------------------------------------
// 2. Router with OTEL plugin + command handlers
// ---------------------------------------------------------------------------

export const orderRouter = new WorkflowRouter(orderWorkflow);

// Wire OpenTelemetry instrumentation — traces every dispatch, records
// transitions and domain events as span events, and exports metrics.
orderRouter.use(createOtelPlugin());

orderRouter
	.state("Draft", ({ on }) => {
		on("Place", ({ command, data, transition, emit, error, workflow }) => {
			if (data.items.length === 0) {
				error({ code: "EmptyCart", data: {} });
			}

			transition("Placed", {
				items: data.items,
				customerEmail: command.payload.customerEmail,
				placedAt: new Date(),
			});

			emit({
				type: "OrderPlaced",
				data: { orderId: workflow.id, customerEmail: command.payload.customerEmail },
			});
		});

		on("Cancel", ({ command, data, transition, emit, workflow }) => {
			transition("Cancelled", {
				items: data.items,
				customerEmail: data.customerEmail,
				cancelledAt: new Date(),
				reason: command.payload.reason,
			});

			emit({
				type: "OrderCancelled",
				data: { orderId: workflow.id, reason: command.payload.reason },
			});
		});
	})
	.state("Placed", ({ on }) => {
		on("Pay", ({ command, data, transition, emit, workflow }) => {
			transition("Paid", {
				items: data.items,
				customerEmail: data.customerEmail,
				placedAt: data.placedAt,
				paidAt: new Date(),
				transactionId: command.payload.transactionId,
			});

			emit({
				type: "OrderPaid",
				data: { orderId: workflow.id, transactionId: command.payload.transactionId },
			});
		});

		on("Cancel", ({ command, data, transition, emit, workflow }) => {
			transition("Cancelled", {
				items: data.items,
				customerEmail: data.customerEmail,
				cancelledAt: new Date(),
				reason: command.payload.reason,
			});

			emit({
				type: "OrderCancelled",
				data: { orderId: workflow.id, reason: command.payload.reason },
			});
		});
	})
	.state("Paid", ({ on }) => {
		on("Ship", ({ command, data, transition, emit, workflow }) => {
			transition("Shipped", {
				items: data.items,
				customerEmail: data.customerEmail,
				placedAt: data.placedAt,
				paidAt: data.paidAt,
				transactionId: data.transactionId,
				shippedAt: new Date(),
				trackingNumber: command.payload.trackingNumber,
			});

			emit({
				type: "OrderShipped",
				data: { orderId: workflow.id, trackingNumber: command.payload.trackingNumber },
			});
		});

		on("Pay", ({ data, error }) => {
			error({ code: "AlreadyPaid", data: { transactionId: data.transactionId } });
		});
	});

// ---------------------------------------------------------------------------
// 3. Lifecycle hooks — structured logging via pino + OTel
// ---------------------------------------------------------------------------

orderRouter.on("dispatch:start", (workflow, command) => {
	logger.info(
		{ workflowId: workflow.id, state: workflow.state, command: command.type },
		"dispatch started",
	);
});

orderRouter.on("transition", (from, to, workflow) => {
	logger.info({ workflowId: workflow.id, from, to }, "state transition");
});

orderRouter.on("dispatch:end", (workflow, command, result) => {
	if (result.ok) {
		logger.info({ workflowId: workflow.id, command: command.type }, "dispatch succeeded");
	} else {
		logger.warn(
			{ workflowId: workflow.id, command: command.type, error: result.error },
			"dispatch failed",
		);
	}
});

orderRouter.on("error", (error, _ctx) => {
	logger.error({ error }, "pipeline error");
});
