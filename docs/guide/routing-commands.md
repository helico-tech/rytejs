# Routing Commands

`WorkflowRouter` maps commands to handlers based on workflow state.

## Creating a Router

```ts
import { WorkflowRouter } from "@ryte/core";

// Without dependencies
const router = new WorkflowRouter(taskWorkflow);

// With typed dependencies
const router = new WorkflowRouter(taskWorkflow, { db, logger });
```

The second argument is an optional dependencies object, accessible in handlers via `ctx.deps`.

## Single-State Handlers

Register handlers for a specific state with `.state()`:

```ts
router.state("todo", (state) => {
  state.on("start", (ctx) => {
    ctx.transition("inProgress", {
      title: ctx.data.title,
      assignee: ctx.command.payload.assignee,
    });
    ctx.emit({
      type: "TaskStarted",
      data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee },
    });
  });

  state.on("rename", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
});
```

Multiple `.state()` calls for the same state are additive -- handlers and middleware accumulate.

## Multi-State Handlers

Register a handler that applies to multiple states by passing an array:

```ts
router.state(["todo", "inProgress"] as const, (state) => {
  state.on("rename", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
});
```

The `as const` assertion is required so TypeScript narrows the state union correctly.

## Wildcard Handlers

Handle a command regardless of current state with `.on("*", ...)`:

```ts
router.on("*", "archive", (ctx) => {
  ctx.transition("archived", { reason: ctx.command.payload.reason });
});
```

## Priority Order

When multiple registrations could match, the most specific wins:

1. **Single-state handler** -- highest priority
2. **Multi-state handler** -- checked if no single-state match
3. **Wildcard handler** -- fallback

```ts
// "draft" + "archive" -> uses specific handler
router.state("draft", (s) => {
  s.on("archive", (ctx) => { /* runs for draft */ });
});

// ["draft", "review"] + "archive" -> used for review, not draft
router.state(["draft", "review"] as const, (s) => {
  s.on("archive", (ctx) => { /* runs for review */ });
});

// "*" + "archive" -> fallback for all other states
router.on("*", "archive", (ctx) => { /* runs for published, etc. */ });
```

## Dispatching Commands

```ts
const result = await router.dispatch(workflow, {
  type: "start",
  payload: { assignee: "alice" },
});
```

## The `DispatchResult` Type

`dispatch()` returns a discriminated union:

```ts
type DispatchResult<TConfig> =
  | { ok: true; workflow: Workflow<TConfig>; events: Array<{ type: string; data: unknown }> }
  | { ok: false; error: PipelineError<TConfig> };
```

Always check `result.ok` before accessing the data:

```ts
const result = await router.dispatch(task, {
  type: "start",
  payload: { assignee: "alice" },
});

if (result.ok) {
  console.log(result.workflow.state); // narrowed to updated state
  console.log(result.events);        // events emitted during dispatch
} else {
  console.log(result.error.category); // "validation" | "domain" | "router"
}
```

See [Error Handling](/guide/error-handling) for details on error categories.
