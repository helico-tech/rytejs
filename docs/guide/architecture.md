# Architecture Patterns

Ryte is designed around a clean separation between domain logic and IO. Handlers are pure decision-makers — they inspect state, validate business rules, and declare what should change. Side effects happen outside the dispatch pipeline.

## The IO / Domain / IO Pattern

A well-structured Ryte integration follows three phases:

```
IO (read)  →  Domain (dispatch)  →  IO (write)
```

1. **IO in:** Load the workflow from storage, parse the incoming command
2. **Domain:** Dispatch the command — pure logic, no IO
3. **IO out:** Persist the updated workflow, publish events, send notifications

```ts
// 1. IO in — load state
const snapshot = await db.get(workflowId);
const restored = definition.restore(snapshot);
if (!restored.ok) throw new Error("Invalid workflow");

// 2. Domain — pure logic, no side effects
const result = await router.dispatch(restored.workflow, command);

// 3. IO out — persist + publish
if (result.ok) {
	await db.transaction(async (tx) => {
		await tx.set(workflowId, definition.snapshot(result.workflow));
		for (const event of result.events) {
			await tx.publish("workflow-events", event);
		}
	});
}
```

The key insight: **handlers never touch the database, send emails, or call external services directly.** They emit events that describe what happened. The IO layer at the end decides how to act on those events.

## Why This Matters

### Handlers Stay Pure

Handlers that perform IO are hard to test, hard to reason about, and fragile. When a handler calls a payment API inside `dispatch()`, you can't test the state transition without mocking the payment service. When the payment service is down, your state machine breaks.

```ts
// Bad: IO inside the handler
state.on("PlaceOrder", async (ctx) => {
	const charge = await paymentService.charge(ctx.data.total); // IO in handler
	if (!charge.ok) return ctx.error({ code: "PaymentFailed", data: {} });
	ctx.transition("Placed", { ... });
});

// Good: handler emits intent, IO layer acts on it
state.on("PlaceOrder", (ctx) => {
	ctx.transition("Placed", { ... });
	ctx.emit({ type: "OrderPlaced", data: { orderId: ctx.workflow.id, total: ctx.data.total } });
});

// After dispatch, the IO layer processes events
if (result.ok) {
	for (const event of result.events) {
		if (event.type === "OrderPlaced") {
			await paymentService.charge(event.data.total);
		}
	}
}
```

### Transactional Consistency

When IO happens after dispatch, you can wrap everything in a transaction. Either the workflow state update AND the event publishing both succeed, or neither does. This is impossible when IO is scattered through handlers.

### Events as the Integration Boundary

Events are the contract between your domain logic and the outside world. They're schema-validated, typed, and accumulated per dispatch. This makes them perfect for:

- **Event sourcing** — store events as the source of truth
- **Message queues** — publish events to Kafka, RabbitMQ, etc.
- **Notifications** — trigger emails, webhooks, push notifications
- **Audit logs** — record what happened and why

## Dependency Injection for Reads

Sometimes handlers need to read external data to make decisions (e.g., check inventory before placing an order). Use dependency injection for this — pass read-only services via `deps`:

```ts
type Deps = {
	inventory: { check: (sku: string) => Promise<boolean> };
};

const router = new WorkflowRouter(definition, deps);

state.on("PlaceOrder", async (ctx) => {
	const inStock = await ctx.deps.inventory.check(ctx.data.sku);
	if (!inStock) {
		return ctx.error({ code: "OutOfStock", data: { sku: ctx.data.sku } });
	}
	ctx.transition("Placed", { ... });
	ctx.emit({ type: "OrderPlaced", data: { ... } });
});
```

This is acceptable — reads are side-effect-free and easy to stub in tests. The rule is: **reads via deps, writes via events.**

## Summary

| Concern | Where | How |
|---------|-------|-----|
| Load workflow | Before dispatch | `restore()` from storage |
| Business rules | Inside handler | `ctx.transition()`, `ctx.error()`, `ctx.emit()` |
| Read external data | Inside handler | Via `ctx.deps` (injected, stubbable) |
| Persist state | After dispatch | `snapshot()` to storage |
| Side effects | After dispatch | Process `result.events` |
| Notifications | After dispatch | React to events |
