import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createKey, defineWorkflow, WorkflowRouter } from "../../src/index.js";

const orderWorkflow = defineWorkflow("order", {
	states: {
		created: z.object({ items: z.array(z.string()), total: z.number() }),
		paid: z.object({ items: z.array(z.string()), total: z.number(), paidAt: z.coerce.date() }),
		shipped: z.object({
			items: z.array(z.string()),
			total: z.number(),
			paidAt: z.coerce.date(),
			trackingNumber: z.string(),
		}),
		delivered: z.object({
			items: z.array(z.string()),
			total: z.number(),
			paidAt: z.coerce.date(),
			trackingNumber: z.string(),
			deliveredAt: z.coerce.date(),
		}),
		cancelled: z.object({ reason: z.string(), cancelledAt: z.coerce.date() }),
	},
	commands: {
		pay: z.object({ amount: z.number() }),
		ship: z.object({ trackingNumber: z.string() }),
		deliver: z.object({}),
		cancel: z.object({ reason: z.string() }),
	},
	events: {
		OrderPaid: z.object({ orderId: z.string(), amount: z.number() }),
		OrderShipped: z.object({ orderId: z.string(), trackingNumber: z.string() }),
		OrderDelivered: z.object({ orderId: z.string() }),
		OrderCancelled: z.object({ orderId: z.string(), reason: z.string() }),
	},
	errors: {
		insufficientPayment: z.object({ required: z.number(), received: z.number() }),
		alreadyShipped: z.object({}),
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

		router.state("created", (state) => {
			state.on("pay", (ctx) => {
				if (ctx.command.payload.amount < ctx.data.total) {
					ctx.error({
						code: "insufficientPayment",
						data: { required: ctx.data.total, received: ctx.command.payload.amount },
					});
				}
				ctx.transition("paid", {
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

		router.state("paid", (state) => {
			state.on("ship", (ctx) => {
				ctx.transition("shipped", {
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

		router.state("shipped", (state) => {
			state.on("deliver", (ctx) => {
				ctx.transition("delivered", {
					items: ctx.data.items,
					total: ctx.data.total,
					paidAt: ctx.data.paidAt,
					trackingNumber: ctx.data.trackingNumber,
					deliveredAt: new Date(),
				});
				ctx.emit({ type: "OrderDelivered", data: { orderId: ctx.workflow.id } });
			});
		});

		router.state(["created", "paid"] as const, (state) => {
			state.on("cancel", (ctx) => {
				ctx.transition("cancelled", {
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
		let wf = orderWorkflow.createWorkflow("order-1", {
			initialState: "created",
			data: { items: ["widget"], total: 50 },
		});

		let result = await router.dispatch(wf, { type: "pay", payload: { amount: 50 } });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("paid");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("OrderPaid");
		wf = result.workflow as any;

		result = await router.dispatch(wf, {
			type: "ship",
			payload: { trackingNumber: "TRACK-123" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("shipped");
		wf = result.workflow as any;

		result = await router.dispatch(wf, { type: "deliver", payload: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("delivered");
	});

	test("domain error with rollback, then successful retry", async () => {
		const { router } = createRouter();
		const wf = orderWorkflow.createWorkflow("order-2", {
			initialState: "created",
			data: { items: ["widget"], total: 100 },
		});

		let result = await router.dispatch(wf, { type: "pay", payload: { amount: 50 } });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("insufficientPayment");
		}

		expect(wf.state).toBe("created");

		result = await router.dispatch(wf, { type: "pay", payload: { amount: 100 } });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("paid");
	});

	test("events don't leak between dispatches", async () => {
		const { router } = createRouter();
		let wf = orderWorkflow.createWorkflow("order-3", {
			initialState: "created",
			data: { items: ["a"], total: 10 },
		});

		const result1 = await router.dispatch(wf, { type: "pay", payload: { amount: 10 } });
		expect(result1.ok).toBe(true);
		if (!result1.ok) throw new Error();
		expect(result1.events).toHaveLength(1);
		wf = result1.workflow as any;

		const result2 = await router.dispatch(wf, {
			type: "ship",
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
			initialState: "created",
			data: { items: ["x"], total: 5 },
		});

		await router.dispatch(wf, { type: "pay", payload: { amount: 5 } });
		expect(deps.auditLog).toEqual(["admin:pay"]);
	});

	test("cancel from created state via multi-state handler", async () => {
		const { router } = createRouter();
		const wf = orderWorkflow.createWorkflow("order-5", {
			initialState: "created",
			data: { items: ["y"], total: 20 },
		});

		const result = await router.dispatch(wf, {
			type: "cancel",
			payload: { reason: "changed mind" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("cancelled");
	});
});
