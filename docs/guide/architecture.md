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

<<< @/snippets/guide/architecture.ts#io-domain-io

The key insight: **handlers never touch the database, send emails, or call external services directly.** They emit events that describe what happened. The IO layer at the end decides how to act on those events.

## Why This Matters

### Handlers Stay Pure

Handlers that perform IO are hard to test, hard to reason about, and fragile. When a handler calls a payment API inside `dispatch()`, you can't test the state transition without mocking the payment service. When the payment service is down, your state machine breaks.

<<< @/snippets/guide/architecture.ts#pure-handlers

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

<<< @/snippets/guide/architecture.ts#deps-reads

This is acceptable — reads are side-effect-free and easy to stub in tests. The rule is: **reads via deps, writes via events.**

## Summary

| Concern | Where | How |
|---------|-------|-----|
| Load workflow | Before dispatch | `restore()` from storage |
| Business rules | Inside handler | `transition()`, `error()`, `emit()` |
| Read external data | Inside handler | Via `deps` (injected, stubbable) |
| Persist state | After dispatch | `snapshot()` to storage |
| Side effects | After dispatch | Process `result.events` |
| Notifications | After dispatch | React to events |
