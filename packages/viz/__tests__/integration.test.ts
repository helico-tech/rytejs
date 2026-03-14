import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { toD2, toMermaid } from "../src/index.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Cancelled: z.object({ reason: z.string() }),
	},
	commands: {
		PlaceOrder: z.object({}),
		CancelOrder: z.object({ reason: z.string() }),
	},
	events: {},
	errors: {},
});

describe("viz integration with @rytejs/core", () => {
	test("router.inspect() output feeds directly into toMermaid()", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});

		const graph = router.inspect();
		const mermaid = toMermaid(graph);
		expect(mermaid).toContain("Draft --> Placed : PlaceOrder");
		expect(mermaid).toContain("Draft --> Cancelled : CancelOrder");
	});

	test("router.inspect() output feeds directly into toD2()", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
		});

		const graph = router.inspect();
		const d2 = toD2(graph);
		expect(d2).toContain("Draft -> Placed: PlaceOrder");
	});
});
