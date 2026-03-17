# Middleware

Middleware uses the Koa-style onion model. Each middleware calls `next()` to pass control inward, then can run logic after the inner layers complete.

## Three Levels

### Global Middleware

Added with `router.use()`. Wraps every dispatch regardless of state.

<<< @/snippets/guide/middleware.ts#global

### State-Scoped Middleware

Added with `use()` inside a `.state()` block. Only runs for handlers registered in that state.

<<< @/snippets/guide/middleware.ts#state-scoped

State middleware does **not** run for wildcard handlers, even if the workflow is in that state.

### Inline Middleware

Passed as extra arguments to `on()` before the handler. Runs only for that specific command.

<<< @/snippets/guide/middleware.ts#inline

## Execution Order

The full onion executes in this order:

```
global-before
  state-before
    inline-before
      handler
    inline-after
  state-after
global-after
```

Verified by test:

<<< @/snippets/guide/middleware.ts#execution-order

## Example: Auth Middleware

<<< @/snippets/guide/middleware.ts#auth

## Example: Logging Middleware

<<< @/snippets/guide/middleware.ts#logging

See [Context Keys](/guide/context-keys) for the full `createKey` / `set` / `get` API.
