# Real-World Example: Order Fulfillment

An order fulfillment workflow demonstrating middleware, multi-state handlers, domain errors, and event emission.

States: `Created` -> `Paid` -> `Shipped` -> `Delivered` (with `Cancelled` reachable from multiple states).

## Workflow Definition

<<< @/snippets/examples/real-world.ts#definition

## Dependencies and Context Keys

<<< @/snippets/examples/real-world.ts#deps-keys

## Router Setup

<<< @/snippets/examples/real-world.ts#router-setup

### Global Middleware: Auth + Audit

Every command is authenticated and logged.

<<< @/snippets/examples/real-world.ts#middleware

### State: `Created`

<<< @/snippets/examples/real-world.ts#state-created

### State: `Paid`

<<< @/snippets/examples/real-world.ts#state-paid

### State: `Shipped`

<<< @/snippets/examples/real-world.ts#state-shipped

### Multi-State: Cancel from `Created` or `Paid`

A single handler registered for multiple states. Once an order is shipped, it can no longer be cancelled.

<<< @/snippets/examples/real-world.ts#multi-state-cancel

## Running the Workflow

### Happy Path

<<< @/snippets/examples/real-world.ts#happy-path

### Error Recovery: Insufficient Payment

<<< @/snippets/examples/real-world.ts#error-recovery

### Cancellation from Multiple States

<<< @/snippets/examples/real-world.ts#cancel

### Audit Trail

<<< @/snippets/examples/real-world.ts#audit

The global middleware logs every command dispatched, building a complete audit trail in the injected `auditLog` dependency.

## Key Patterns Demonstrated

| Pattern | Where |
| ------- | ----- |
| Middleware (auth + audit) | Global `.use()` with `createKey` |
| Multi-state handler | `Cancel` from `Created` or `Paid` |
| Domain error + recovery | Insufficient payment, then retry |
| Event emission | Every state transition emits a typed event |
| Dependency injection | `auditLog` via router constructor |
| Rollback on error | Failed payment leaves order in `Created` |
