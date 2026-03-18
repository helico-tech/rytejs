import { serve } from "@hono/node-server";
import { defineGenericPlugin, WorkflowRouter } from "@rytejs/core";
import { createEngine, memoryAdapter } from "@rytejs/core/engine";
import { createBroadcaster } from "@rytejs/sync/server";
import { Hono } from "hono";
import type { Item } from "./src/workflow.js";
import { orderDefinition } from "./src/workflow.js";

// --- Debug logging plugin ---

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const debugPlugin = defineGenericPlugin((router) => {
	router.on("dispatch:start", (workflow, command) => {
		console.log(
			`\n${dim(new Date().toISOString())} ${bold(">>>")} ${cyan(command.type)} on ${yellow(workflow.id)} ${dim(`[${workflow.state}]`)}`,
		);
		console.log(dim(`    payload: ${JSON.stringify(command.payload)}`));
	});

	router.on("transition", (from, to, workflow) => {
		console.log(`    ${yellow(from)} ${dim("->")} ${green(to)} ${dim(`(${workflow.id})`)}`);
	});

	router.on("event", (event) => {
		console.log(`    ${dim("event:")} ${cyan(event.type)} ${dim(JSON.stringify(event.data))}`);
	});

	router.on("error", (error) => {
		console.log(
			`    ${red("error:")} [${error.category}] ${error.category === "domain" ? error.code : (error.message ?? "")}`,
		);
	});

	router.on("dispatch:end", (_workflow, command, result) => {
		const status = result.ok ? green("OK") : red("FAIL");
		console.log(`${dim(new Date().toISOString())} ${bold("<<<")} ${cyan(command.type)} ${status}`);
	});
});

// --- Delay plugin (200-1000ms) ---

const delayPlugin = defineGenericPlugin((router) => {
	router.use(async (_ctx, next) => {
		const ms = 200 + Math.floor(Math.random() * 800);
		console.log(dim(`    ~ simulated delay: ${ms}ms`));
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
		await next();
	});
});

// --- Router with handlers (server-only) ---

const router = new WorkflowRouter(orderDefinition);
router.use(debugPlugin);
router.use(delayPlugin);

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
	console.log(dim(`${new Date().toISOString()} GET /api/orders (${orderRegistry.size} orders)`));
	const orders = Array.from(orderRegistry.entries()).map(([id, meta]) => ({
		id,
		createdAt: meta.createdAt,
	}));
	return c.json(orders);
});

app.put("/api/order/:id", async (c) => {
	const { id } = c.req.param();
	const body = await c.req.json();
	console.log(`${dim(new Date().toISOString())} ${bold("PUT")} /api/order/${cyan(id)}`);
	try {
		const result = await engine.create("order", id, {
			initialState: body.initialState ?? "Draft",
			data: body.data ?? { customer: "", items: [] },
		});
		orderRegistry.set(id, { createdAt: new Date().toISOString() });
		console.log(`    ${green("created")} version=${result.version}`);
		return c.json({ ok: true, snapshot: result.workflow, version: result.version }, 201);
	} catch (err) {
		console.log(`    ${red("error")} ${String(err)}`);
		return c.json({ ok: false, error: { category: "unexpected", message: String(err) } }, 500);
	}
});

app.post("/api/order/:id", async (c) => {
	const { id } = c.req.param();
	const body = await c.req.json();
	console.log(
		`${dim(new Date().toISOString())} ${bold("POST")} /api/order/${cyan(id)} ${dim(body.type)}`,
	);
	try {
		const result = await broadcaster.execute("order", id, {
			type: body.type,
			payload: body.payload,
		});
		if (!result.result.ok) {
			console.log(`    ${red("dispatch failed")} [${result.result.error.category}]`);
			return c.json({ ok: false, error: result.result.error }, 422);
		}
		// biome-ignore lint/suspicious/noExplicitAny: engine returns generic WorkflowConfig types — cast through type erasure boundary
		const snapshot = router.definition.snapshot(result.result.workflow as any);
		console.log(`    ${green("dispatched")} version=${result.version}`);
		return c.json({ ok: true, snapshot, version: result.version });
	} catch (err) {
		console.log(`    ${red("error")} ${String(err)}`);
		return c.json({ ok: false, error: { category: "unexpected", message: String(err) } }, 500);
	}
});

app.get("/api/order/:id", async (c) => {
	const { id } = c.req.param();
	console.log(`${dim(new Date().toISOString())} ${bold("GET")} /api/order/${cyan(id)}`);
	const stored = await engine.load(id);
	if (!stored) {
		console.log(`    ${red("not found")}`);
		return c.json({ ok: false, error: { category: "not_found" } }, 404);
	}
	console.log(`    ${green("loaded")} [${stored.snapshot.state}] version=${stored.version}`);
	return c.json({ ok: true, snapshot: stored.snapshot, version: stored.version });
});

app.get("/api/order/:id/events", async (c) => {
	const { id } = c.req.param();
	console.log(
		`${dim(new Date().toISOString())} ${bold("SSE")} /api/order/${cyan(id)}/events ${dim("(subscribed)")}`,
	);
	return broadcaster.subscribe("order", id);
});

app.delete("/api/order/:id", (c) => {
	const { id } = c.req.param();
	console.log(`${dim(new Date().toISOString())} ${bold("DELETE")} /api/order/${cyan(id)}`);
	orderRegistry.delete(id);
	return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: 3001 }, () => {
	console.log("Server running on http://localhost:3001");
});
