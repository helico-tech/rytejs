import type { WorkflowSnapshot } from "@rytejs/core";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// ── Order workflow — used for #io-domain-io, #pure-handlers, #deps-reads ─────

const orderWorkflow = defineWorkflow("order", {
	states: {
		Pending: z.object({ total: z.number(), sku: z.string() }),
		Placed: z.object({ total: z.number(), sku: z.string() }),
	},
	commands: {
		PlaceOrder: z.object({}),
	},
	events: {
		OrderPlaced: z.object({ orderId: z.string(), total: z.number() }),
	},
	errors: {
		PaymentFailed: z.object({}),
		OutOfStock: z.object({ sku: z.string() }),
	},
});

const definition = orderWorkflow;
const router = new WorkflowRouter(orderWorkflow);

// ── External service stubs ────────────────────────────────────────────────────

declare const db: {
	get(id: string): Promise<WorkflowSnapshot>;
	transaction(
		fn: (tx: {
			set(id: string, data: unknown): Promise<void>;
			publish(channel: string, event: unknown): Promise<void>;
		}) => Promise<void>,
	): Promise<void>;
};

declare const workflowId: string;

// command typed to match what router.dispatch() expects
declare const command: Parameters<typeof router.dispatch>[1];

declare const paymentService: {
	charge(total: number): Promise<{ ok: boolean }>;
};

// ── #io-domain-io ─────────────────────────────────────────────────────────────

(async () => {
	// #region io-domain-io
	// 1. IO in — load state
	const snapshot = await db.get(workflowId);
	const restored = definition.deserialize(snapshot);
	if (!restored.ok) throw new Error("Invalid workflow");

	// 2. Domain — pure logic, no side effects
	const result = await router.dispatch(restored.workflow, command);

	// 3. IO out — persist + publish
	if (result.ok) {
		await db.transaction(async (tx) => {
			await tx.set(workflowId, definition.serialize(result.workflow));
			for (const event of result.events) {
				await tx.publish("workflow-events", event);
			}
		});
	}
	// #endregion io-domain-io
})();

// ── #pure-handlers ────────────────────────────────────────────────────────────

// #region pure-handlers
// Bad: IO inside the handler
const badRouter = new WorkflowRouter(orderWorkflow);
badRouter.state("Pending", ({ on }) => {
	on("PlaceOrder", async ({ data, error, transition }) => {
		const charge = await paymentService.charge(data.total); // IO in handler
		if (!charge.ok) return error({ code: "PaymentFailed", data: {} });
		transition("Placed", { total: data.total, sku: data.sku });
	});
});

// Good: handler emits intent, IO layer acts on it
const goodRouter = new WorkflowRouter(orderWorkflow);
goodRouter.state("Pending", ({ on }) => {
	on("PlaceOrder", ({ data, transition, emit, workflow }) => {
		transition("Placed", { total: data.total, sku: data.sku });
		emit({ type: "OrderPlaced", data: { orderId: workflow.id, total: data.total } });
	});
});
// #endregion pure-handlers

const order = orderWorkflow.createWorkflow("order-1", {
	initialState: "Pending",
	data: { total: 99.99, sku: "WIDGET-42" },
});

(async () => {
	const result = await goodRouter.dispatch(order, {
		type: "PlaceOrder",
		payload: {},
	});

	// After dispatch, the IO layer processes events
	if (result.ok) {
		for (const event of result.events) {
			if (event.type === "OrderPlaced") {
				const eventData = event.data as { total: number };
				await paymentService.charge(eventData.total);
			}
		}
	}
})();

// ── #deps-reads ───────────────────────────────────────────────────────────────

// #region deps-reads
type Deps = {
	inventory: { check: (sku: string) => Promise<boolean> };
};

declare const deps: Deps;

const depsRouter = new WorkflowRouter(orderWorkflow, deps);

depsRouter.state("Pending", ({ on }) => {
	on("PlaceOrder", async ({ deps, data, error, transition, emit, workflow }) => {
		const inStock = await deps.inventory.check(data.sku);
		if (!inStock) {
			return error({ code: "OutOfStock", data: { sku: data.sku } });
		}
		transition("Placed", { total: data.total, sku: data.sku });
		emit({ type: "OrderPlaced", data: { orderId: workflow.id, total: data.total } });
	});
});
// #endregion deps-reads

void badRouter;
void depsRouter;
