import type { ConfigOf, DispatchResult } from "@rytejs/core";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// ── Order workflow — used for #domain-definition, #domain-handler, #narrowing ─

// #region domain-definition
const orderWorkflow = defineWorkflow("order", {
	states: {
		Created: z.object({ total: z.number() }),
		Paid: z.object({ total: z.number(), paidAt: z.coerce.date() }),
	},
	commands: {
		Pay: z.object({ amount: z.number() }),
		Ship: z.object({}),
	},
	events: {
		OrderPaid: z.object({ orderId: z.string() }),
	},
	errors: {
		InsufficientPayment: z.object({ required: z.number(), received: z.number() }),
		AlreadyShipped: z.object({}),
	},
});
// #endregion domain-definition

const orderRouter = new WorkflowRouter(orderWorkflow);

// ── #domain-handler ───────────────────────────────────────────────────────────

// #region domain-handler
orderRouter.state("Created", ({ on }) => {
	on("Pay", ({ command, data, error, transition, emit, workflow }) => {
		if (command.payload.amount < data.total) {
			error({
				code: "InsufficientPayment",
				data: {
					required: data.total,
					received: command.payload.amount,
				},
			});
		}
		transition("Paid", { total: data.total, paidAt: new Date() });
		emit({ type: "OrderPaid", data: { orderId: workflow.id } });
	});
});
// #endregion domain-handler

// ── Task workflow — used for #rollback ────────────────────────────────────────

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
	},
	events: {},
	errors: {},
});

// Router with no handlers — dispatching "Start" returns a router error.
const taskRouter = new WorkflowRouter(taskWorkflow);

// ── #rollback ─────────────────────────────────────────────────────────────────

// #region rollback
(async () => {
	const task = taskWorkflow.createWorkflow("task-1", {
		initialState: "Todo",
		data: { title: "Original" },
	});

	const result = await taskRouter.dispatch(task, { type: "Start", payload: { assignee: "x" } });

	if (!result.ok) {
		console.log(task.state); // still "Todo"
		console.log(task.data.title); // still "Original"
	}
})();
// #endregion rollback

// ── #narrowing ────────────────────────────────────────────────────────────────

// #region narrowing
function handleResult(result: DispatchResult<ConfigOf<typeof orderRouter>>) {
	if (!result.ok) {
		switch (result.error.category) {
			case "validation":
				console.log("Validation failed:", result.error.source);
				for (const issue of result.error.issues) {
					console.log(`  - ${issue.message}`);
				}
				break;
			case "domain":
				console.log("Business rule:", result.error.code);
				break;
			case "router":
				console.log("Router:", result.error.message);
				break;
			case "dependency":
				console.log("Dependency failed:", result.error.name);
				break;
			case "unexpected":
				console.log("Unexpected:", result.error.message);
				break;
		}
	}
}
// #endregion narrowing

void taskRouter;
void handleResult;
