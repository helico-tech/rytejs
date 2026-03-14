# Introspection

Introspection exposes the static shape and transition graph of your workflows programmatically.

## Definition Info

Every workflow definition has an `inspect()` method that returns its states, commands, events, and error codes:

```ts
import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Shipped: z.object({ items: z.array(z.string()), trackingId: z.string() }),
	},
	commands: {
		PlaceOrder: z.object({}),
		ShipOrder: z.object({ trackingId: z.string() }),
	},
	events: {
		OrderPlaced: z.object({ id: z.string() }),
	},
	errors: {
		OutOfStock: z.object({ item: z.string() }),
	},
});

const info = definition.inspect();
info.name;     // "order"
info.states;   // ["Draft", "Placed", "Shipped"]
info.commands; // ["PlaceOrder", "ShipOrder"]
info.events;   // ["OrderPlaced"]
info.errors;   // ["OutOfStock"]
```

The return type is `DefinitionInfo<TConfig>` — a plain object with typed arrays.

## Transition Graph

The router's `inspect()` method returns the full transition graph, built from registered handlers and their declared targets:

```ts
import { WorkflowRouter } from "@rytejs/core";

const router = new WorkflowRouter(definition);
router.state("Draft", (state) => {
	state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
		ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
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
graph.transitions;
// [
//   { from: "Draft", command: "PlaceOrder", to: ["Placed"] },
//   { from: "Placed", command: "ShipOrder", to: ["Shipped"] },
// ]
```

### Declaring Targets

Targets are declared as an options object before the handler (and any inline middleware):

```ts
// Without targets (transitions unknown to introspection)
state.on("PlaceOrder", (ctx) => { ... });

// With targets
state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => { ... });

// With targets and inline middleware
state.on("PlaceOrder", { targets: ["Placed"] }, authMiddleware, (ctx) => { ... });

// Wildcard handlers support targets too
router.on("*", "Cancel", { targets: ["Cancelled"] }, (ctx) => { ... });
```

Targets are optional — handlers without targets still work, but `inspect()` reports their transitions with an empty `to` array.

### Priority in the Graph

The transition graph respects the same priority rules as dispatch:

1. **Single-state handlers** take precedence
2. **Multi-state handlers** fill in where no single-state handler exists
3. **Wildcard handlers** expand to every state not already covered

## Use Cases

The introspection output is plain data. You can use it for:

- **Visualization** — generate state diagrams with `@rytejs/viz`
- **Validation** — verify that all states are reachable
- **Documentation** — auto-generate workflow docs
- **Testing** — assert expected transitions exist
