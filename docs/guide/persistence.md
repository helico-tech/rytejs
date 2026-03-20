# Persistence

Your workflow is pure — no IO, no side effects. The executor is the IO shell that loads, saves, and coordinates.

## The Executor

The `WorkflowExecutor` wraps a router with `create()` and `execute()` methods. Both return `ExecutionResult` — they never throw.

<<< @/snippets/guide/persistence.ts#executor-create

Without middleware, the executor validates and dispatches but doesn't persist. Add `withStore` to save state between calls.

## Adding Persistence

The `withStore` middleware loads the workflow before dispatch and saves it after:

<<< @/snippets/guide/persistence.ts#with-store

Internally, `withStore` follows this sequence:

1. **create**: check for duplicates → dispatch to core handler → save snapshot
2. **execute**: load from store → restore workflow → dispatch command → save snapshot

## StoreAdapter Interface

The executor delegates persistence to a `StoreAdapter`:

<<< @/snippets/guide/persistence.ts#store-interface

| Method | Responsibility |
| --- | --- |
| `load(id)` | Return `{ snapshot, version }` or `null` |
| `save(options)` | Persist snapshot with optimistic concurrency |

## Optimistic Concurrency

Every save includes an `expectedVersion`. If the stored version doesn't match, the adapter throws `ConcurrencyConflictError`. This provides safe concurrent access without locks — the first writer wins, others retry.

## The Outbox Pattern

`SaveOptions` includes an `events` field. When your store adapter saves the snapshot and events in a single transaction, you get the **outbox pattern** — atomic state + event persistence with no lost events:

<<< @/snippets/guide/persistence.ts#outbox-pattern

## Custom Store

Here's a PostgreSQL adapter sketch with transaction-based outbox:

<<< @/snippets/guide/persistence.ts#custom-store

## Error Categories

The executor distinguishes between executor-level errors and dispatch errors that pass through from the router:

**Executor errors:** `not_found`, `conflict`, `already_exists`, `restore`, `unexpected`

**Dispatch errors (from router):** `validation`, `domain`, `router`, `dependency`, `unexpected`

See [Error Handling](/guide/error-handling) for the full dispatch error taxonomy.

<<< @/snippets/guide/persistence.ts#error-handling
