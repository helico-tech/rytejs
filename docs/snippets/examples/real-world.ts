import type { Workflow } from "@rytejs/core";
import { createKey, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region definition
const orderWorkflow = defineWorkflow("order", {
	states: {
		Created: z.object({ items: z.array(z.string()), total: z.number() }),
		Paid: z.object({
			items: z.array(z.string()),
			total: z.number(),
			paidAt: z.coerce.date(),
		}),
		Shipped: z.object({
			items: z.array(z.string()),
			total: z.number(),
			paidAt: z.coerce.date(),
			trackingNumber: z.string(),
		}),
		Delivered: z.object({
			items: z.array(z.string()),
			total: z.number(),
			paidAt: z.coerce.date(),
			trackingNumber: z.string(),
			deliveredAt: z.coerce.date(),
		}),
		Cancelled: z.object({
			reason: z.string(),
			cancelledAt: z.coerce.date(),
		}),
	},
	commands: {
		Pay: z.object({ amount: z.number() }),
		Ship: z.object({ trackingNumber: z.string() }),
		Deliver: z.object({}),
		Cancel: z.object({ reason: z.string() }),
	},
	events: {
		OrderPaid: z.object({ orderId: z.string(), amount: z.number() }),
		OrderShipped: z.object({ orderId: z.string(), trackingNumber: z.string() }),
		OrderDelivered: z.object({ orderId: z.string() }),
		OrderCancelled: z.object({ orderId: z.string(), reason: z.string() }),
	},
	errors: {
		InsufficientPayment: z.object({ required: z.number(), received: z.number() }),
		AlreadyShipped: z.object({}),
	},
});
// #endregion definition

// #region deps-keys
type Deps = { auditLog: string[] };
const AuthKey = createKey<string>("auth");
// #endregion deps-keys

// #region router-setup
const deps: Deps = { auditLog: [] };
const router = new WorkflowRouter(orderWorkflow, deps);
// #endregion router-setup

// #region middleware
router.use(async ({ set, get, deps, command }, next) => {
	// Set authenticated user (in production: validate JWT, check session)
	set(AuthKey, "admin");

	// Audit trail
	deps.auditLog.push(`${get(AuthKey)}:${command.type}`);

	await next();
});
// #endregion middleware

// #region state-created
router.state("Created", ({ on }) => {
	on("Pay", ({ command, data, error, transition, emit, workflow }) => {
		// Domain validation: check payment amount
		if (command.payload.amount < data.total) {
			error({
				code: "InsufficientPayment",
				data: {
					required: data.total,
					received: command.payload.amount,
				},
			});
		}

		transition("Paid", {
			items: data.items,
			total: data.total,
			paidAt: new Date(),
		});

		emit({
			type: "OrderPaid",
			data: { orderId: workflow.id, amount: command.payload.amount },
		});
	});
});
// #endregion state-created

// #region state-paid
router.state("Paid", ({ on }) => {
	on("Ship", ({ data, command, transition, emit, workflow }) => {
		transition("Shipped", {
			items: data.items,
			total: data.total,
			paidAt: data.paidAt,
			trackingNumber: command.payload.trackingNumber,
		});

		emit({
			type: "OrderShipped",
			data: {
				orderId: workflow.id,
				trackingNumber: command.payload.trackingNumber,
			},
		});
	});
});
// #endregion state-paid

// #region state-shipped
router.state("Shipped", ({ on }) => {
	on("Deliver", ({ data, transition, emit, workflow }) => {
		transition("Delivered", {
			items: data.items,
			total: data.total,
			paidAt: data.paidAt,
			trackingNumber: data.trackingNumber,
			deliveredAt: new Date(),
		});

		emit({
			type: "OrderDelivered",
			data: { orderId: workflow.id },
		});
	});
});
// #endregion state-shipped

// #region multi-state-cancel
router.state(["Created", "Paid"] as const, ({ on }) => {
	on("Cancel", ({ command, transition, emit, workflow }) => {
		transition("Cancelled", {
			reason: command.payload.reason,
			cancelledAt: new Date(),
		});

		emit({
			type: "OrderCancelled",
			data: {
				orderId: workflow.id,
				reason: command.payload.reason,
			},
		});
	});
});
// #endregion multi-state-cancel

(async () => {
	// #region happy-path
	let order: Workflow<typeof orderWorkflow.config> = orderWorkflow.createWorkflow("order-1", {
		initialState: "Created",
		data: { items: ["widget"], total: 50 },
	});

	// Pay
	let result = await router.dispatch(order, {
		type: "Pay",
		payload: { amount: 50 },
	});
	// result.ok === true
	// result.workflow.state === "Paid"
	// result.events[0].type === "OrderPaid"
	if (!result.ok) throw new Error("Unexpected error");
	order = result.workflow;

	// Ship
	result = await router.dispatch(order, {
		type: "Ship",
		payload: { trackingNumber: "TRACK-123" },
	});
	// result.workflow.state === "Shipped"
	if (!result.ok) throw new Error("Unexpected error");
	order = result.workflow;

	// Deliver
	result = await router.dispatch(order, {
		type: "Deliver",
		payload: {},
	});
	// result.workflow.state === "Delivered"
	// #endregion happy-path
})();

(async () => {
	// #region error-recovery
	const order = orderWorkflow.createWorkflow("order-2", {
		initialState: "Created",
		data: { items: ["widget"], total: 100 },
	});

	// Attempt underpayment
	let result = await router.dispatch(order, {
		type: "Pay",
		payload: { amount: 50 },
	});

	if (!result.ok && result.error.category === "domain") {
		console.log(result.error.code);
		// "InsufficientPayment"
		console.log(result.error.data);
		// { required: 100, received: 50 }
	}

	// Original order is unchanged -- rollback happened
	console.log(order.state); // still "Created"

	// Retry with correct amount
	result = await router.dispatch(order, {
		type: "Pay",
		payload: { amount: 100 },
	});
	// result.ok === true
	// result.workflow.state === "Paid"
	// #endregion error-recovery
})();

(async () => {
	// #region cancel
	// Cancel from "Created"
	const order1 = orderWorkflow.createWorkflow("order-3", {
		initialState: "Created",
		data: { items: ["x"], total: 20 },
	});
	await router.dispatch(order1, {
		type: "Cancel",
		payload: { reason: "changed mind" },
	});
	// result.workflow.state === "Cancelled"

	// Cancel from "Paid" also works (same handler)
	// #endregion cancel
})();

// #region audit
console.log(deps.auditLog);
// ["admin:Pay", "admin:Ship", "admin:Deliver", ...]
// #endregion audit
