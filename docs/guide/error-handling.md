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

`PipelineError` is a discriminated union with three categories.

### Validation Errors

Zod validation failed. The `source` field tells you where:

| Source         | When                                           |
| -------------- | ---------------------------------------------- |
| `"command"`    | Command payload doesn't match its schema       |
| `"state"`      | `ctx.update()` produced invalid state data     |
| `"transition"` | `ctx.transition()` data doesn't match target   |
| `"event"`      | `ctx.emit()` data doesn't match event schema   |

```ts
if (!result.ok && result.error.category === "validation") {
  console.log(result.error.source);  // "command" | "state" | "event" | "transition"
  console.log(result.error.issues);  // z.core.$ZodIssue[]
  console.log(result.error.message); // human-readable summary
}
```

### Domain Errors

Raised by handlers via `ctx.error()`. These represent business rule violations.

```ts
router.state("created", (state) => {
  state.on("pay", (ctx) => {
    if (ctx.command.payload.amount < ctx.data.total) {
      ctx.error({
        code: "insufficientPayment",
        data: {
          required: ctx.data.total,
          received: ctx.command.payload.amount,
        },
      });
    }
    // ... transition to paid
  });
});
```

Domain errors carry a typed `code` and `data`, validated against the error schema defined in the workflow:

```ts
if (!result.ok && result.error.category === "domain") {
  console.log(result.error.code); // "insufficientPayment"
  console.log(result.error.data); // { required: 100, received: 50 }
}
```

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

```ts
const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "todo",
  data: { title: "Original" },
});

const result = await router.dispatch(task, { type: "start", payload: { assignee: "x" } });

if (!result.ok) {
  console.log(task.state);      // still "todo"
  console.log(task.data.title); // still "Original"
}
```

The router works on internal copies. On error, those copies are discarded.

## Narrowing Error Types

Use the `category` field to narrow and access category-specific fields:

```ts
const result = await router.dispatch(workflow, command);

if (!result.ok) {
  switch (result.error.category) {
    case "validation":
      // result.error.source, result.error.issues, result.error.message
      console.log("Validation failed:", result.error.source);
      for (const issue of result.error.issues) {
        console.log(`  - ${issue.message}`);
      }
      break;
    case "domain":
      // result.error.code, result.error.data
      console.log("Business rule:", result.error.code);
      break;
    case "router":
      // result.error.code, result.error.message
      console.log("Router:", result.error.message);
      break;
  }
}
```
