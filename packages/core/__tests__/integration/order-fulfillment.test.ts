import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createKey, defineWorkflow, type Workflow, WorkflowRouter } from "../../src/index.js";

const orderWorkflow = defineWorkflow("order", {
	states: {
		Created: z.object({ items: z.array(z.string()), total: z.number() }),
		Paid: z.object({ items: z.array(z.string()), total: z.number(), paidAt: z.coerce.date() }),
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
		Cancelled: z.object({ reason: z.string(), cancelledAt: z.coerce.date() }),
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

type Deps = { auditLog: string[] };
const AuthKey = createKey<string>("auth");

describe("Order Fulfillment Integration", () => {
	function createRouter() {
		const deps: Deps = { auditLog: [] };
		const router = new WorkflowRouter(orderWorkflow, deps);

		router.use(async (ctx, next) => {
			ctx.set(AuthKey, "admin");
			deps.auditLog.push(`${ctx.get(AuthKey)}:${ctx.command.type}`);
			await next();
		});

		router.state("Created", (state) => {
			state.on("Pay", (ctx) => {
				if (ctx.command.payload.amount < ctx.data.total) {
					ctx.error({
						code: "InsufficientPayment",
						data: { required: ctx.data.total, received: ctx.command.payload.amount },
					});
				}
				ctx.transition("Paid", {
					items: ctx.data.items,
					total: ctx.data.total,
					paidAt: new Date(),
				});
				ctx.emit({
					type: "OrderPaid",
					data: { orderId: ctx.workflow.id, amount: ctx.command.payload.amount },
				});
			});
		});

		router.state("Paid", (state) => {
			state.on("Ship", (ctx) => {
				ctx.transition("Shipped", {
					items: ctx.data.items,
					total: ctx.data.total,
					paidAt: ctx.data.paidAt,
					trackingNumber: ctx.command.payload.trackingNumber,
				});
				ctx.emit({
					type: "OrderShipped",
					data: { orderId: ctx.workflow.id, trackingNumber: ctx.command.payload.trackingNumber },
				});
			});
		});

		router.state("Shipped", (state) => {
			state.on("Deliver", (ctx) => {
				ctx.transition("Delivered", {
					items: ctx.data.items,
					total: ctx.data.total,
					paidAt: ctx.data.paidAt,
					trackingNumber: ctx.data.trackingNumber,
					deliveredAt: new Date(),
				});
				ctx.emit({ type: "OrderDelivered", data: { orderId: ctx.workflow.id } });
			});
		});

		router.state(["Created", "Paid"] as const, (state) => {
			state.on("Cancel", (ctx) => {
				ctx.transition("Cancelled", {
					reason: ctx.command.payload.reason,
					cancelledAt: new Date(),
				});
				ctx.emit({
					type: "OrderCancelled",
					data: { orderId: ctx.workflow.id, reason: ctx.command.payload.reason },
				});
			});
		});

		return { router, deps };
	}

	test("full lifecycle: created → paid → shipped → delivered", async () => {
		const { router } = createRouter();
		let wf: Workflow<typeof orderWorkflow.config> = orderWorkflow.createWorkflow("order-1", {
			initialState: "Created",
			data: { items: ["widget"], total: 50 },
		});

		let result = await router.dispatch(wf, { type: "Pay", payload: { amount: 50 } });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Paid");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("OrderPaid");
		wf = result.workflow;

		result = await router.dispatch(wf, {
			type: "Ship",
			payload: { trackingNumber: "TRACK-123" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Shipped");
		wf = result.workflow;

		result = await router.dispatch(wf, { type: "Deliver", payload: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Delivered");
	});

	test("domain error with rollback, then successful retry", async () => {
		const { router } = createRouter();
		const wf = orderWorkflow.createWorkflow("order-2", {
			initialState: "Created",
			data: { items: ["widget"], total: 100 },
		});

		let result = await router.dispatch(wf, { type: "Pay", payload: { amount: 50 } });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("InsufficientPayment");
		}

		expect(wf.state).toBe("Created");

		result = await router.dispatch(wf, { type: "Pay", payload: { amount: 100 } });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Paid");
	});

	test("events don't leak between dispatches", async () => {
		const { router } = createRouter();
		let wf: Workflow<typeof orderWorkflow.config> = orderWorkflow.createWorkflow("order-3", {
			initialState: "Created",
			data: { items: ["a"], total: 10 },
		});

		const result1 = await router.dispatch(wf, { type: "Pay", payload: { amount: 10 } });
		expect(result1.ok).toBe(true);
		if (!result1.ok) throw new Error();
		expect(result1.events).toHaveLength(1);
		wf = result1.workflow;

		const result2 = await router.dispatch(wf, {
			type: "Ship",
			payload: { trackingNumber: "T1" },
		});
		expect(result2.ok).toBe(true);
		if (!result2.ok) throw new Error();
		expect(result2.events).toHaveLength(1);
		expect(result2.events[0]?.type).toBe("OrderShipped");
	});

	test("middleware injects auth and logs audit trail", async () => {
		const { router, deps } = createRouter();
		const wf = orderWorkflow.createWorkflow("order-4", {
			initialState: "Created",
			data: { items: ["x"], total: 5 },
		});

		await router.dispatch(wf, { type: "Pay", payload: { amount: 5 } });
		expect(deps.auditLog).toEqual(["admin:Pay"]);
	});

	test("cancel from created state via multi-state handler", async () => {
		const { router } = createRouter();
		const wf = orderWorkflow.createWorkflow("order-5", {
			initialState: "Created",
			data: { items: ["y"], total: 20 },
		});

		const result = await router.dispatch(wf, {
			type: "Cancel",
			payload: { reason: "changed mind" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Cancelled");
	});
});
