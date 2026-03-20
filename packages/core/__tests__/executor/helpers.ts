import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { WorkflowRouter } from "../../src/router.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.date() }),
	},
	commands: {
		Place: z.object({}),
		AddItem: z.object({ item: z.string() }),
	},
	events: {
		OrderPlaced: z.object({ orderId: z.string() }),
	},
	errors: {
		EmptyOrder: z.object({}),
	},
});

function createTestRouter() {
	const router = new WorkflowRouter(definition);

	router.state("Draft", ({ on }) => {
		on("Place", ({ data, transition, emit, error, workflow }) => {
			if (data.items.length === 0) {
				error({ code: "EmptyOrder", data: {} });
			}
			transition("Placed", { items: data.items, placedAt: new Date() });
			emit({ type: "OrderPlaced", data: { orderId: workflow.id } });
		});

		on("AddItem", ({ data, update, command }) => {
			update({ items: [...data.items, command.payload.item] });
		});
	});

	return router;
}

export { createTestRouter, definition };
