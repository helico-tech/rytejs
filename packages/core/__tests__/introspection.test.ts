import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Shipped: z.object({ items: z.array(z.string()), trackingId: z.string() }),
		Cancelled: z.object({ reason: z.string() }),
	},
	commands: {
		PlaceOrder: z.object({}),
		ShipOrder: z.object({ trackingId: z.string() }),
		CancelOrder: z.object({ reason: z.string() }),
	},
	events: {
		OrderPlaced: z.object({ id: z.string() }),
		OrderShipped: z.object({ id: z.string() }),
	},
	errors: {
		OutOfStock: z.object({ item: z.string() }),
	},
});

describe("definition.inspect()", () => {
	test("returns all state names", () => {
		const info = definition.inspect();
		expect(info.states).toEqual(
			expect.arrayContaining(["Draft", "Placed", "Shipped", "Cancelled"]),
		);
		expect(info.states).toHaveLength(4);
	});

	test("returns all command names", () => {
		const info = definition.inspect();
		expect(info.commands).toEqual(
			expect.arrayContaining(["PlaceOrder", "ShipOrder", "CancelOrder"]),
		);
		expect(info.commands).toHaveLength(3);
	});

	test("returns all event names", () => {
		const info = definition.inspect();
		expect(info.events).toEqual(expect.arrayContaining(["OrderPlaced", "OrderShipped"]));
		expect(info.events).toHaveLength(2);
	});

	test("returns all error codes", () => {
		const info = definition.inspect();
		expect(info.errors).toEqual(["OutOfStock"]);
	});

	test("includes definition name", () => {
		const info = definition.inspect();
		expect(info.name).toBe("order");
	});
});

describe("router.inspect()", () => {
	test("returns transitions from handlers with targets", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});
		router.state("Placed", (state) => {
			state.on("ShipOrder", { targets: ["Shipped"] }, (ctx) => {
				ctx.transition("Shipped", {
					items: ctx.data.items,
					trackingId: ctx.command.payload.trackingId,
				});
			});
		});

		const graph = router.inspect();
		expect(graph.definition.name).toBe("order");
		expect(graph.transitions).toEqual(
			expect.arrayContaining([
				{ from: "Draft", command: "PlaceOrder", to: ["Placed"] },
				{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
				{ from: "Placed", command: "ShipOrder", to: ["Shipped"] },
			]),
		);
		expect(graph.transitions).toHaveLength(3);
	});

	test("handlers without targets produce empty to array", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
		});

		const graph = router.inspect();
		expect(graph.transitions).toEqual([{ from: "Draft", command: "PlaceOrder", to: [] }]);
	});

	test("includes wildcard handler transitions", () => {
		const router = new WorkflowRouter(definition);
		router.on("*", "CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
			ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
		});

		const graph = router.inspect();
		const cancelTransitions = graph.transitions.filter((t) => t.command === "CancelOrder");
		expect(cancelTransitions).toHaveLength(4); // one per state
		for (const t of cancelTransitions) {
			expect(t.to).toEqual(["Cancelled"]);
		}
	});

	test("includes multi-state handler transitions", () => {
		const router = new WorkflowRouter(definition);
		router.state(["Draft", "Placed"] as const, (state) => {
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});

		const graph = router.inspect();
		const cancelTransitions = graph.transitions.filter((t) => t.command === "CancelOrder");
		expect(cancelTransitions).toEqual(
			expect.arrayContaining([
				{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
				{ from: "Placed", command: "CancelOrder", to: ["Cancelled"] },
			]),
		);
		expect(cancelTransitions).toHaveLength(2);
	});

	test("wildcard does not duplicate transitions for states with specific handlers", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});
		router.on("*", "CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
			ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
		});

		const graph = router.inspect();
		const cancelDraft = graph.transitions.filter(
			(t) => t.from === "Draft" && t.command === "CancelOrder",
		);
		expect(cancelDraft).toHaveLength(1);
	});

	test("includes definition info in graph", () => {
		const router = new WorkflowRouter(definition);
		const graph = router.inspect();
		expect(graph.definition).toEqual(definition.inspect());
	});
});
