import { routeToDO, WorkflowDO } from "@rytejs/cloudflare";
import { WorkflowRouter } from "@rytejs/core";
import type { Item } from "./src/workflow.js";
import { orderDefinition } from "./src/workflow.js";

// --- Router with handlers (server-side only) ---

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

// --- Durable Object ---

export class OrderDO extends WorkflowDO {
	routers = [router];
}

// --- Worker entry ---

interface Env {
	WORKFLOW_DO: DurableObjectNamespace;
	ASSETS: Fetcher;
}

export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url);

		// API routes → strip /api prefix, forward to DO
		if (url.pathname.startsWith("/api/order/")) {
			const stripped = url.pathname.slice(4); // "/api/order/..." → "/order/..."
			const newUrl = new URL(stripped + url.search, url.origin);
			const apiRequest = new Request(newUrl.toString(), request);
			return routeToDO(apiRequest, env as never, "WORKFLOW_DO");
		}

		// Static assets (React build)
		return env.ASSETS.fetch(request);
	},
};
