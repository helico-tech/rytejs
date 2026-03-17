# Routing Commands

`WorkflowRouter` maps commands to handlers based on workflow state.

## Creating a Router

<<< @/snippets/guide/routing-commands.ts#create-router

The second argument is an optional dependencies object, accessible in handlers via `deps`.

## Single-State Handlers

Register handlers for a specific state with `.state()`:

<<< @/snippets/guide/routing-commands.ts#single-state

Multiple `.state()` calls for the same state are additive -- handlers and middleware accumulate.

## Multi-State Handlers

Register a handler that applies to multiple states by passing an array:

<<< @/snippets/guide/routing-commands.ts#multi-state

The `as const` assertion is required so TypeScript narrows the state union correctly.

## Wildcard Handlers

Handle a command regardless of current state with `.on("*", ...)`:

<<< @/snippets/guide/routing-commands.ts#wildcard

## Priority Order

When multiple registrations could match, the most specific wins:

1. **Single-state handler** -- highest priority
2. **Multi-state handler** -- checked if no single-state match
3. **Wildcard handler** -- fallback

<<< @/snippets/guide/routing-commands.ts#priority

## Composable Routers

Split handler registration across routers and compose them with `.use()`:

<<< @/snippets/guide/routing-commands.ts#composable

Each child router must use the same workflow definition. The merge is eager -- changes to the child after `.use()` do not affect the parent.

### Handler Priority

When both parent and child register a handler for the same state + command, the parent's handler wins. Child handlers only fill in what the parent doesn't have.

### Middleware Ordering

The child's global middleware is appended after the parent's. State-scoped middleware from the child is appended after the parent's state-scoped middleware for the same state.

### Nested Composition

Routers can be nested arbitrarily:

<<< @/snippets/guide/routing-commands.ts#nested

## Dispatching Commands

<<< @/snippets/guide/routing-commands.ts#dispatch

## The `DispatchResult` Type

`dispatch()` returns a discriminated union:

```ts
type DispatchResult<TConfig> =
  | { ok: true; workflow: Workflow<TConfig>; events: Array<{ type: EventNames<TConfig>; data: unknown }> }
  | { ok: false; error: PipelineError<TConfig> };
```

Always check `result.ok` before accessing the data:

<<< @/snippets/guide/routing-commands.ts#result-check

See [Error Handling](/guide/error-handling) for details on error categories.
