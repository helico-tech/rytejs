import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import {
	createTestDeps,
	createTestWorkflow,
	expectError,
	expectOk,
	testPath,
} from "@rytejs/testing";
import { z } from "zod";
import { taskRouter, taskWorkflow } from "../fixtures.js";

// ── Order workflow — used for #create-test-workflow, #create-with-id, #expect-ok, #expect-error ──

const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.unknown()) }),
		Placed: z.object({
			orderId: z.string(),
			items: z.array(z.object({ sku: z.string(), qty: z.number() })),
		}),
	},
	commands: {
		PlaceOrder: z.object({}),
	},
	events: {
		OrderPlaced: z.object({ orderId: z.string() }),
	},
	errors: {
		OutOfStock: z.object({}),
	},
});

// #region create-test-workflow
const wf = createTestWorkflow(orderWorkflow, "Placed", {
	orderId: "123",
	items: [{ sku: "ABC", qty: 1 }],
});

// wf.state === "Placed"
// wf.data === { orderId: "123", items: [...] }
// #endregion create-test-workflow

// #region create-with-id
const wfWithId = createTestWorkflow(orderWorkflow, "Draft", { items: [] }, { id: "my-id" });
// #endregion create-with-id

// ── Router for #expect-ok — handles PlaceOrder on Draft, transitions to Placed ──

const okRouter = new WorkflowRouter(orderWorkflow);
okRouter.state("Draft", ({ on }) => {
	on("PlaceOrder", ({ workflow, transition, emit }) => {
		transition("Placed", {
			orderId: workflow.id,
			items: [{ sku: "ABC", qty: 1 }],
		});
		emit({ type: "OrderPlaced", data: { orderId: workflow.id } });
	});
});

// #region expect-ok
(async () => {
	const draftWf = createTestWorkflow(orderWorkflow, "Draft", { items: [] });
	const result = await okRouter.dispatch(draftWf, { type: "PlaceOrder", payload: {} });

	expectOk(result); // asserts ok, narrows type
	expectOk(result, "Placed"); // also checks state
})();
// #endregion expect-ok

// ── Router for #expect-error — handler always calls error() ──────────────────

const errRouter = new WorkflowRouter(orderWorkflow);
errRouter.state("Draft", ({ on }) => {
	on("PlaceOrder", ({ error }) => {
		error({ code: "OutOfStock", data: {} });
	});
});

// #region expect-error
(async () => {
	const draftWf = createTestWorkflow(orderWorkflow, "Draft", { items: [] });
	const result = await errRouter.dispatch(draftWf, { type: "PlaceOrder", payload: {} });

	expectError(result, "domain"); // asserts domain error
	expectError(result, "domain", "OutOfStock"); // also checks code
})();
// #endregion expect-error

// #region test-path
(async () => {
	await testPath(taskRouter, taskWorkflow, [
		{
			start: "Todo",
			data: { title: "Fix bug", priority: 0 },
			command: "Start",
			payload: { assignee: "alice" },
			expect: "InProgress",
		},
		{ command: "Complete", payload: {}, expect: "Done" },
	]);
})();
// #endregion test-path

// ── #test-deps ────────────────────────────────────────────────────────────────

// Stub for vi.fn() — vitest is not a docs dependency
declare const vi: {
	fn: () => { mockResolvedValue: (v: unknown) => (...args: unknown[]) => Promise<boolean> };
};

type MyDeps = {
	paymentService: { charge: (...args: unknown[]) => Promise<boolean> };
};

// #region test-deps
const deps = createTestDeps<MyDeps>({
	paymentService: { charge: vi.fn().mockResolvedValue(true) },
});

const router = new WorkflowRouter(orderWorkflow, deps);
// #endregion test-deps

void wf;
void wfWithId;
void router;
