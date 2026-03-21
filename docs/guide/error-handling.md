# Error Handling

Every `dispatch()` returns a `DispatchResult` -- a discriminated union you check with `result.ok`.

```ts
const result = await router.dispatch(workflow, command);

if (result.ok) {
  // result.workflow -- updated snapshot
  // result.events   -- emitted events
} else {
  // result.error -- PipelineError
}
```

## Error Categories

`PipelineError` is a discriminated union with five categories.

### Validation Errors

Zod validation failed. The `source` field tells you where:

| Source         | When                                           |
| -------------- | ---------------------------------------------- |
| `"command"`    | Command payload doesn't match its schema       |
| `"state"`      | `update()` produced invalid state data         |
| `"transition"` | `transition()` data doesn't match target       |
| `"event"`      | `emit()` data doesn't match event schema       |
| `"restore"`    | `deserialize()` data doesn't match state schema |

> **Note:** The `"restore"` source only appears from `definition.deserialize()`, not from `dispatch()`.

```ts
if (!result.ok && result.error.category === "validation") {
  console.log(result.error.source);  // "command" | "state" | "event" | "transition"
  console.log(result.error.issues);  // z.core.$ZodIssue[]
  console.log(result.error.message); // human-readable summary
}
```

### Domain Errors

Business rule violations defined upfront in the workflow definition. Each error code has a Zod schema, making your failure modes part of the workflow's contract:

<<< @/snippets/guide/error-handling.ts#domain-definition

Handlers raise them via `error()`:

<<< @/snippets/guide/error-handling.ts#domain-handler

Domain errors carry a typed `code` and `data`, validated against the error schema defined in the workflow:

```ts
if (!result.ok && result.error.category === "domain") {
  console.log(result.error.code); // "InsufficientPayment"
  console.log(result.error.data); // { required: 100, received: 50 }
}
```

### Unexpected Errors

When a handler throws a value that is neither a domain error nor a validation error, the dispatch catches it and returns an `"unexpected"` error instead of letting the exception propagate:

```ts
if (!result.ok && result.error.category === "unexpected") {
  console.log(result.error.message); // human-readable summary
  console.log(result.error.error);   // the original thrown value
}
```

`pipeline:end` always fires even when an unexpected error occurs, so hooks and plugins that observe `pipeline:end` will always run.

### Dependency Errors

When a dependency injected via the router constructor throws during dispatch, the error is automatically caught and returned as a `"dependency"` error. This lets you distinguish infrastructure failures (database down, API timeout) from handler bugs (`"unexpected"`).

Dependencies are wrapped in a Proxy by default — no handler code changes required.

```ts
if (!result.ok && result.error.category === "dependency") {
	console.log(result.error.name);    // top-level dep key, e.g. "db"
	console.log(result.error.message); // 'Dependency "db" failed: Connection refused'
	console.log(result.error.error);   // the original thrown error
}
```

To disable dependency wrapping:

```ts
const router = new WorkflowRouter(definition, deps, { wrapDeps: false });
```

With wrapping disabled, dependency errors fall through to `"unexpected"`.

### Router Errors

The router itself couldn't find a handler.

| Code             | When                                            |
| ---------------- | ----------------------------------------------- |
| `"NO_HANDLER"`   | No handler registered for this state + command  |
| `"UNKNOWN_STATE"` | Workflow's state isn't in the definition        |

```ts
if (!result.ok && result.error.category === "router") {
  console.log(result.error.code);    // "NO_HANDLER" | "UNKNOWN_STATE"
  console.log(result.error.message); // human-readable description
}
```

## Rollback on Error

All mutations are provisional. If dispatch fails for any reason, the original workflow object is unchanged.

<<< @/snippets/guide/error-handling.ts#rollback

The router works on internal copies. On error, those copies are discarded.

## Narrowing Error Types

Use the `category` field to narrow and access category-specific fields:

<<< @/snippets/guide/error-handling.ts#narrowing
