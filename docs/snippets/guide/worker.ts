import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { memoryAdapter } from "@rytejs/core/engine";
import { createWorker, defineWorkerPlugin } from "@rytejs/worker";
import { z } from "zod";

// ── Inline workflow definitions for worker examples ──────────────────────

const orderWorkflow = defineWorkflow("order", {
	states: {
		Placed: z.object({ customerId: z.string(), total: z.number() }),
		Paid: z.object({ customerId: z.string(), total: z.number(), paidAt: z.coerce.date() }),
		Shipped: z.object({
			customerId: z.string(),
			total: z.number(),
			paidAt: z.coerce.date(),
			trackingId: z.string(),
		}),
	},
	commands: {
		ConfirmPayment: z.object({ transactionId: z.string() }),
		Ship: z.object({ trackingId: z.string() }),
	},
	events: {
		OrderPaid: z.object({ orderId: z.string(), customerId: z.string() }),
		OrderShipped: z.object({ orderId: z.string(), trackingId: z.string() }),
	},
	errors: {
		PaymentFailed: z.object({ reason: z.string() }),
	},
});

const orderRouter = new WorkflowRouter(orderWorkflow);

orderRouter.state("Placed", ({ on }) => {
	on("ConfirmPayment", ({ data, transition, emit, workflow }) => {
		transition("Paid", { customerId: data.customerId, total: data.total, paidAt: new Date() });
		emit({ type: "OrderPaid", data: { orderId: workflow.id, customerId: data.customerId } });
	});
});

orderRouter.state("Paid", ({ on }) => {
	on("Ship", ({ data, command, transition, emit, workflow }) => {
		transition("Shipped", {
			customerId: data.customerId,
			total: data.total,
			paidAt: data.paidAt,
			trackingId: command.payload.trackingId,
		});
		emit({
			type: "OrderShipped",
			data: { orderId: workflow.id, trackingId: command.payload.trackingId },
		});
	});
});

const shipmentWorkflow = defineWorkflow("shipment", {
	states: {
		Pending: z.object({ orderId: z.string(), trackingId: z.string() }),
		Dispatched: z.object({
			orderId: z.string(),
			trackingId: z.string(),
			dispatchedAt: z.coerce.date(),
		}),
	},
	commands: {
		CreateShipment: z.object({ orderId: z.string(), trackingId: z.string() }),
		Dispatch: z.object({}),
	},
	events: {
		ShipmentCreated: z.object({ shipmentId: z.string() }),
		ShipmentDispatched: z.object({ shipmentId: z.string() }),
	},
	errors: {},
});

const shipmentRouter = new WorkflowRouter(shipmentWorkflow);

shipmentRouter.state("Pending", ({ on }) => {
	on("Dispatch", ({ data, transition, emit, workflow }) => {
		transition("Dispatched", {
			orderId: data.orderId,
			trackingId: data.trackingId,
			dispatchedAt: new Date(),
		});
		emit({ type: "ShipmentDispatched", data: { shipmentId: workflow.id } });
	});
});

// ── #create-worker ───────────────────────────────────────────────────────

// #region create-worker
const adapter = memoryAdapter({ ttl: 30_000 });

const worker = createWorker({
	routers: [orderRouter, shipmentRouter],
	store: adapter,
	queue: adapter,
	lock: adapter,
	concurrency: 4,
	pollInterval: 500,
});
// #endregion create-worker

// ── #send ────────────────────────────────────────────────────────────────

// #region send
(async () => {
	await worker.send(orderRouter, "order-1", {
		type: "ConfirmPayment",
		payload: { transactionId: "tx-abc" },
	});
})();
// #endregion send

// ── #lifecycle ───────────────────────────────────────────────────────────

// #region lifecycle
(async () => {
	await worker.start();

	// ... process commands until shutdown signal ...

	await worker.stop(); // waits for in-flight commands (up to shutdownTimeout)
})();
// #endregion lifecycle

// ── #retry-policy ────────────────────────────────────────────────────────

// #region retry-policy
const retryWorker = createWorker({
	routers: [orderRouter],
	store: adapter,
	queue: adapter,
	retryPolicy: {
		dependency: { action: "retry", maxRetries: 5, backoff: "exponential" },
		unexpected: { action: "retry", maxRetries: 3, backoff: "fixed" },
		domain: { action: "dead-letter" },
		validation: { action: "drop" },
		router: { action: "drop" },
	},
});
// #endregion retry-policy

// ── #backoff ─────────────────────────────────────────────────────────────

// #region backoff
const backoffWorker = createWorker({
	routers: [orderRouter],
	store: adapter,
	queue: adapter,
	retryPolicy: {
		dependency: {
			action: "retry",
			maxRetries: 5,
			// Full config: exponential backoff starting at 2s, capped at 60s
			backoff: { strategy: "exponential", base: 2_000, max: 60_000 },
		},
		unexpected: {
			action: "retry",
			maxRetries: 3,
			// Full config: fixed 5s delay between retries
			backoff: { strategy: "fixed", delay: 5_000 },
		},
	},
});
// #endregion backoff

// ── #reactors ────────────────────────────────────────────────────────────

// #region reactors
worker.react(orderRouter, "OrderShipped", ({ event, workflowId }) => {
	const data = event.data as { trackingId: string };

	return {
		workflowId: `shipment-${workflowId}`,
		router: shipmentRouter,
		command: {
			type: "CreateShipment",
			payload: { orderId: workflowId, trackingId: data.trackingId },
		},
	};
});
// #endregion reactors

// ── #reactor-null ────────────────────────────────────────────────────────

// #region reactor-null
worker.react(orderRouter, "OrderPaid", ({ event }) => {
	const data = event.data as { customerId: string };

	// Skip VIP customers — they have a separate fulfillment path
	if (data.customerId.startsWith("vip-")) {
		return null;
	}

	return {
		workflowId: `auto-ship-${data.customerId}`,
		router: orderRouter,
		command: { type: "Ship", payload: { trackingId: "auto-generated" } },
	};
});
// #endregion reactor-null

// ── #hooks ───────────────────────────────────────────────────────────────

// #region hooks
worker.on("worker:started", () => {
	console.log("Worker started");
});

worker.on("worker:stopped", () => {
	console.log("Worker stopped");
});

worker.on("command:started", ({ workflowId, message }) => {
	console.log(`Processing ${message.type} for ${workflowId}`);
});

worker.on("command:completed", ({ workflowId, message }) => {
	console.log(`Completed ${message.type} for ${workflowId}`);
});

worker.on("command:failed", ({ workflowId, message, action }) => {
	console.log(`Failed ${message.type} for ${workflowId}, action: ${action}`);
});

worker.on("command:retried", ({ workflowId, attempt, maxRetries, delay }) => {
	console.log(`Retrying ${workflowId}: attempt ${attempt}/${maxRetries}, delay ${delay}ms`);
});

worker.on("command:dead-lettered", ({ workflowId, reason }) => {
	console.log(`Dead-lettered ${workflowId}: ${reason}`);
});

worker.on("command:dropped", ({ workflowId, message }) => {
	console.log(`Dropped ${message.type} for ${workflowId}`);
});
// #endregion hooks

// ── #plugin ──────────────────────────────────────────────────────────────

// #region plugin
const metricsPlugin = defineWorkerPlugin((hooks) => {
	let processed = 0;
	let failed = 0;

	hooks.on("command:completed", () => {
		processed++;
	});

	hooks.on("command:failed", () => {
		failed++;
	});

	hooks.on("worker:stopped", () => {
		console.log(`Processed: ${processed}, Failed: ${failed}`);
	});
});

worker.use(metricsPlugin);
// #endregion plugin

void retryWorker;
void backoffWorker;
