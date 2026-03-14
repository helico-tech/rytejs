# Real-World Example: Order Fulfillment

An order fulfillment workflow demonstrating middleware, multi-state handlers, domain errors, and event emission.

States: `created` -> `paid` -> `shipped` -> `delivered` (with `cancelled` reachable from multiple states).

## Workflow Definition

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter, createKey } from "@ryte/core";

const orderWorkflow = defineWorkflow("order", {
  states: {
    created: z.object({ items: z.array(z.string()), total: z.number() }),
    paid: z.object({
      items: z.array(z.string()),
      total: z.number(),
      paidAt: z.coerce.date(),
    }),
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
    cancelled: z.object({
      reason: z.string(),
      cancelledAt: z.coerce.date(),
    }),
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
```

## Dependencies and Context Keys

```ts
type Deps = { auditLog: string[] };
const AuthKey = createKey<string>("auth");
```

## Router Setup

```ts
const deps: Deps = { auditLog: [] };
const router = new WorkflowRouter(orderWorkflow, deps);
```

### Global Middleware: Auth + Audit

Every command is authenticated and logged.

```ts
router.use(async (ctx, next) => {
  // Set authenticated user (in production: validate JWT, check session)
  ctx.set(AuthKey, "admin");

  // Audit trail
  ctx.deps.auditLog.push(`${ctx.get(AuthKey)}:${ctx.command.type}`);

  await next();
});
```

### State: `created`

```ts
router.state("created", (state) => {
  state.on("pay", (ctx) => {
    // Domain validation: check payment amount
    if (ctx.command.payload.amount < ctx.data.total) {
      ctx.error({
        code: "insufficientPayment",
        data: {
          required: ctx.data.total,
          received: ctx.command.payload.amount,
        },
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
```

### State: `paid`

```ts
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
      data: {
        orderId: ctx.workflow.id,
        trackingNumber: ctx.command.payload.trackingNumber,
      },
    });
  });
});
```

### State: `shipped`

```ts
router.state("shipped", (state) => {
  state.on("deliver", (ctx) => {
    ctx.transition("delivered", {
      items: ctx.data.items,
      total: ctx.data.total,
      paidAt: ctx.data.paidAt,
      trackingNumber: ctx.data.trackingNumber,
      deliveredAt: new Date(),
    });

    ctx.emit({
      type: "OrderDelivered",
      data: { orderId: ctx.workflow.id },
    });
  });
});
```

### Multi-State: Cancel from `created` or `paid`

A single handler registered for multiple states. Once an order is shipped, it can no longer be cancelled.

```ts
router.state(["created", "paid"] as const, (state) => {
  state.on("cancel", (ctx) => {
    ctx.transition("cancelled", {
      reason: ctx.command.payload.reason,
      cancelledAt: new Date(),
    });

    ctx.emit({
      type: "OrderCancelled",
      data: {
        orderId: ctx.workflow.id,
        reason: ctx.command.payload.reason,
      },
    });
  });
});
```

## Running the Workflow

### Happy Path

```ts
let order = orderWorkflow.createWorkflow("order-1", {
  initialState: "created",
  data: { items: ["widget"], total: 50 },
});

// Pay
let result = await router.dispatch(order, {
  type: "pay",
  payload: { amount: 50 },
});
// result.ok === true
// result.workflow.state === "paid"
// result.events[0].type === "OrderPaid"
order = result.workflow;

// Ship
result = await router.dispatch(order, {
  type: "ship",
  payload: { trackingNumber: "TRACK-123" },
});
// result.workflow.state === "shipped"
order = result.workflow;

// Deliver
result = await router.dispatch(order, {
  type: "deliver",
  payload: {},
});
// result.workflow.state === "delivered"
```

### Error Recovery: Insufficient Payment

```ts
const order = orderWorkflow.createWorkflow("order-2", {
  initialState: "created",
  data: { items: ["widget"], total: 100 },
});

// Attempt underpayment
let result = await router.dispatch(order, {
  type: "pay",
  payload: { amount: 50 },
});

if (!result.ok && result.error.category === "domain") {
  console.log(result.error.code);
  // "insufficientPayment"
  console.log(result.error.data);
  // { required: 100, received: 50 }
}

// Original order is unchanged -- rollback happened
console.log(order.state); // still "created"

// Retry with correct amount
result = await router.dispatch(order, {
  type: "pay",
  payload: { amount: 100 },
});
// result.ok === true
// result.workflow.state === "paid"
```

### Cancellation from Multiple States

```ts
// Cancel from "created"
const order1 = orderWorkflow.createWorkflow("order-3", {
  initialState: "created",
  data: { items: ["x"], total: 20 },
});
await router.dispatch(order1, {
  type: "cancel",
  payload: { reason: "changed mind" },
});
// result.workflow.state === "cancelled"

// Cancel from "paid" also works (same handler)
```

### Audit Trail

```ts
console.log(deps.auditLog);
// ["admin:pay", "admin:ship", "admin:deliver", ...]
```

The global middleware logs every command dispatched, building a complete audit trail in the injected `auditLog` dependency.

## Key Patterns Demonstrated

| Pattern | Where |
| ------- | ----- |
| Middleware (auth + audit) | Global `.use()` with `createKey` |
| Multi-state handler | `cancel` from `created` or `paid` |
| Domain error + recovery | Insufficient payment, then retry |
| Event emission | Every state transition emits a typed event |
| Dependency injection | `auditLog` via router constructor |
| Rollback on error | Failed payment leaves order in `created` |
