import { serve } from "@hono/node-server";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { createEngine, memoryAdapter } from "@rytejs/core/engine";
import { createBroadcaster } from "@rytejs/sync/server";
import { Hono } from "hono";
import { z } from "zod";

// --- Workflow definition (same schema as client) ---

const itemSchema = z.object({
	name: z.string(),
	quantity: z.number().int().positive(),
	price: z.number().positive(),
});

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

type Item = z.infer<typeof itemSchema>;

// --- Router with handlers ---

const router = new WorkflowRouter(orderDefinition);

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
		transition("Submitted", {
			customer: data.customer,
			items: data.items,
			submittedAt: new Date(),
		});
		emit({
			type: "OrderSubmitted",
			data: { orderId: workflow.id, customer: data.customer, itemCount: data.items.length },
		});
	});
});

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

router.state("Rejected", ({ on }) => {
	on("Resubmit", ({ data, transition }) => {
		transition("Draft", {
			customer: data.customer,
			items: data.items,
		});
	});
});

// --- Engine + Broadcaster ---

const adapter = memoryAdapter({ ttl: 60_000 });
const engine = createEngine({
	store: adapter,
	routers: { order: router },
	lock: adapter,
});
const broadcaster = createBroadcaster({ engine });

// --- In-memory order registry ---

const orderRegistry = new Map<string, { createdAt: string }>();

// --- Hono routes ---

const app = new Hono();

app.get("/api/orders", (c) => {
	const orders = Array.from(orderRegistry.entries()).map(([id, meta]) => ({
		id,
		createdAt: meta.createdAt,
	}));
	return c.json(orders);
});

app.put("/api/order/:id", async (c) => {
	const { id } = c.req.param();
	const body = await c.req.json();
	try {
		const result = await engine.create("order", id, {
			initialState: body.initialState ?? "Draft",
			data: body.data ?? { customer: "", items: [] },
		});
		orderRegistry.set(id, { createdAt: new Date().toISOString() });
		return c.json({ ok: true, snapshot: result.workflow, version: result.version }, 201);
	} catch (err) {
		return c.json({ ok: false, error: { category: "unexpected", message: String(err) } }, 500);
	}
});

app.post("/api/order/:id", async (c) => {
	const { id } = c.req.param();
	const body = await c.req.json();
	try {
		const result = await broadcaster.execute("order", id, {
			type: body.type,
			payload: body.payload,
		});
		if (!result.result.ok) {
			return c.json({ ok: false, error: result.result.error }, 422);
		}
		// biome-ignore lint/suspicious/noExplicitAny: engine returns generic WorkflowConfig types — cast through type erasure boundary
		const snapshot = router.definition.snapshot(result.result.workflow as any);
		return c.json({ ok: true, snapshot, version: result.version });
	} catch (err) {
		return c.json({ ok: false, error: { category: "unexpected", message: String(err) } }, 500);
	}
});

app.get("/api/order/:id", async (c) => {
	const { id } = c.req.param();
	const stored = await engine.load(id);
	if (!stored) return c.json({ ok: false, error: { category: "not_found" } }, 404);
	return c.json({ ok: true, snapshot: stored.snapshot, version: stored.version });
});

app.get("/api/order/:id/events", async (c) => {
	const { id } = c.req.param();
	return broadcaster.subscribe("order", id);
});

app.delete("/api/order/:id", (c) => {
	const { id } = c.req.param();
	orderRegistry.delete(id);
	return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: 3001 }, () => {
	console.log("Server running on http://localhost:3001");
});
