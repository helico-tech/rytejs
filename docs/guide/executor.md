# Executor

The `WorkflowExecutor` is the IO shell around the pure router: **load → dispatch → save**. It takes a router and a store, runs your middleware pipeline, and handles concurrency.

## Store Interface

The executor delegates persistence to the `StoreAdapter` interface:

| Method | Responsibility |
| --- | --- |
| `load(id)` | Load a workflow snapshot by ID |
| `save(options)` | Persist a snapshot with optimistic concurrency |

`save()` takes an `expectedVersion` for optimistic concurrency control — throw `ConcurrencyConflictError` if the stored version doesn't match.

<<< @/snippets/guide/executor.ts#adapters

## Memory Store

For testing and prototyping, use the built-in memory store:

<<< @/snippets/guide/executor.ts#memory-store

## Creating an Executor

Pass a router and a store to the constructor:

<<< @/snippets/guide/executor.ts#create-executor

## Executing Commands

`executor.execute()` loads the workflow, runs the middleware pipeline, dispatches the command, saves the result, and returns:

<<< @/snippets/guide/executor.ts#execute

## Optimistic Locking

Pass `expectedVersion` to reject stale writes early:

<<< @/snippets/guide/executor.ts#expected-version

## Middleware

Middleware runs after the workflow is loaded but before the save. Use it for auth, logging, rate limiting, or any cross-cutting concern that needs access to the stored workflow:

<<< @/snippets/guide/executor.ts#middleware

Middleware executes in Koa-style onion order — the first middleware added wraps the rest.

## Error Handling

Dispatch errors (domain, validation, router) are returned inside `ExecutionResult`, never thrown. Store adapters throw `ConcurrencyConflictError` for optimistic locking failures at the database level:

<<< @/snippets/guide/executor.ts#error-handling
