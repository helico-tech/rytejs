# Engine

The [Integrations guide](/guide/integrations) shows how to wire Ryte into any runtime with five steps: receive, load, dispatch, persist, publish. The `WorkflowExecutor` encapsulates that entire loop behind `create()` and `execute()` calls, with pluggable middleware for storage, broadcasting, and more.

## Why Use the Executor

| Manual integration | `WorkflowExecutor` |
| --- | --- |
| You implement load/save/lock/enqueue | `withStore` middleware handles it |
| You handle concurrency conflicts | Optimistic locking built-in |
| You wire up every endpoint | `createFetch()` gives you a standard HTTP API |
| Full control over every step | Composable middleware pipeline |

Use the executor when you want a batteries-included runtime. Use manual integration when you need full control over the execution loop.

## Store Interface

The engine delegates persistence to the `StoreAdapter` interface:

| Method | Responsibility |
| --- | --- |
| `load(id)` | Load a workflow snapshot by ID |
| `save(options)` | Persist a snapshot with optimistic concurrency |

`save()` takes an `expectedVersion` for optimistic concurrency control -- throw `ConcurrencyConflictError` if the stored version doesn't match.

<<< @/snippets/guide/engine.ts#adapters

## Memory Store

For testing and prototyping, use the built-in memory store:

<<< @/snippets/guide/engine.ts#memory-store

## Creating an Executor

Create a `WorkflowExecutor` and add the `withStore` middleware:

<<< @/snippets/guide/engine.ts#create-executor

## Creating Workflows

`executor.create()` validates the initial data against Zod schemas, checks for duplicates, and persists the snapshot:

<<< @/snippets/guide/engine.ts#create-workflow

## Executing Commands

`executor.execute()` loads, restores, dispatches, saves, and returns events in one call:

<<< @/snippets/guide/engine.ts#execute

## HTTP Handler

`createFetch()` returns a `(Request) => Promise<Response>` function compatible with any Web Standard API server:

<<< @/snippets/guide/engine.ts#http-handler

| Method | Path | Action |
| --- | --- | --- |
| `PUT` | `/:name/:id` | Create workflow |
| `POST` | `/:name/:id` | Execute command |
| `GET` | `/:name/:id` | Load workflow |

## Error Handling

Store adapters throw `ConcurrencyConflictError` for optimistic locking failures. Dispatch errors (domain, validation, router) are returned inside the `ExecutionResult`, not thrown.

<<< @/snippets/guide/engine.ts#error-handling
