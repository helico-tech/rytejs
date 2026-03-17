# Engine

The [Integrations guide](/guide/integrations) shows how to wire Ryte into any runtime with five steps: receive, load, dispatch, persist, publish. The `ExecutionEngine` encapsulates that entire loop -- load, lock, dispatch, save, enqueue -- behind a single `execute()` call.

## Why Use the Engine

| Manual integration | `ExecutionEngine` |
| --- | --- |
| You implement load/save/lock/enqueue | Adapters handle it |
| You handle concurrency conflicts | Optimistic locking built-in |
| You wire up every endpoint | `createHandler()` gives you a standard HTTP API |
| Full control over every step | Convention over configuration |

Use the engine when you want a batteries-included runtime. Use manual integration when you need full control over the execution loop.

## Adapter Interfaces

The engine delegates all IO to three adapter interfaces:

| Adapter | Responsibility | Methods |
| --- | --- | --- |
| `StoreAdapter` | Persist workflow snapshots | `load`, `save` |
| `LockAdapter` | Prevent concurrent execution | `acquire`, `release` |
| `QueueAdapter` | Enqueue events for async processing | `enqueue`, `dequeue`, `ack`, `nack`, `deadLetter` |

`save()` takes an `expectedVersion` for optimistic concurrency control -- throw `ConcurrencyConflictError` if the stored version doesn't match.

<<< @/snippets/guide/engine.ts#adapters

## Creating an Engine

Pass your adapters and a map of named routers:

<<< @/snippets/guide/engine.ts#create-engine

The `lock` and `queue` options are optional. When `lock` is omitted, the engine uses an in-memory lock with a 30-second TTL.

## Creating Workflows

`engine.create()` validates the initial data against Zod schemas, acquires a lock, checks for duplicates, and persists the snapshot:

<<< @/snippets/guide/engine.ts#create-workflow

Throws `WorkflowAlreadyExistsError` if the ID already exists, `LockConflictError` if the lock is held.

## Executing Commands

`engine.execute()` loads, locks, restores, dispatches, saves, and enqueues events in one call:

<<< @/snippets/guide/engine.ts#execute

The returned `ExecutionResult` contains:

| Field | Type | Description |
| --- | --- | --- |
| `result` | `DispatchResult` | The dispatch outcome (`ok` / error) |
| `events` | `EmittedEvent[]` | Events emitted during dispatch |
| `version` | `number` | The new version after save |

## Memory Adapters

For testing and prototyping, use the built-in memory adapters:

<<< @/snippets/guide/engine.ts#memory-adapters

Each factory returns a standalone adapter backed by in-process data structures. The `memoryLock` requires a `ttl` option (milliseconds) to auto-expire stale locks.

## Transactional Path

When you pass the same object as both `store` and `queue`, the engine detects this and uses `TransactionalAdapter.transaction()` to save the snapshot and enqueue events atomically. The `memoryAdapter()` factory returns a single object that implements all four interfaces:

<<< @/snippets/guide/engine.ts#transactional

For production, implement a single adapter that wraps both store and queue operations in a database transaction (e.g., PostgreSQL with an outbox table).

## HTTP Handler

`createHandler()` returns a `(Request) => Promise<Response>` function compatible with any Web Standard API server:

<<< @/snippets/guide/engine.ts#http-handler

| Method | Path | Action |
| --- | --- | --- |
| `PUT` | `/:router/:id` | Create workflow |
| `POST` | `/:router/:id` | Execute command |
| `GET` | `/:router/:id` | Load workflow |

The handler maps engine errors to HTTP status codes automatically:

| Error | Status | Category |
| --- | --- | --- |
| `WorkflowNotFoundError` | 404 | `not_found` |
| `RouterNotFoundError` | 404 | `not_found` |
| `WorkflowAlreadyExistsError` | 409 | `conflict` |
| `ConcurrencyConflictError` | 409 | `conflict` |
| `LockConflictError` | 409 | `conflict` |
| `RestoreError` | 500 | `restore_error` |
| Dispatch domain error | 422 | `domain` |
| Dispatch validation error | 400 | `validation` |

## Error Handling

Engine methods throw typed errors for infrastructure failures. Dispatch errors (domain, validation, router) are returned inside `ExecutionResult.result`, not thrown.

<<< @/snippets/guide/engine.ts#error-handling

| Error class | When thrown |
| --- | --- |
| `LockConflictError` | Lock is held by another process |
| `ConcurrencyConflictError` | Version mismatch on save (optimistic locking) |
| `WorkflowNotFoundError` | `execute()` called with unknown ID |
| `WorkflowAlreadyExistsError` | `create()` called with duplicate ID |
| `RouterNotFoundError` | Router name not in the `routers` map |
| `RestoreError` | Snapshot fails Zod validation on restore |
