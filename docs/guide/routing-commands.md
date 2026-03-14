# Routing Commands

`WorkflowRouter` maps commands to handlers based on workflow state.

## Creating a Router

```ts
import { WorkflowRouter } from "@rytejs/core";

// Without dependencies
const router = new WorkflowRouter(taskWorkflow);

// With typed dependencies
const router = new WorkflowRouter(taskWorkflow, { db, logger });
```

The second argument is an optional dependencies object, accessible in handlers via `ctx.deps`.

## Single-State Handlers

Register handlers for a specific state with `.state()`:

```ts
router.state("Todo", (state) => {
  state.on("Start", (ctx) => {
    ctx.transition("InProgress", {
      title: ctx.data.title,
      assignee: ctx.command.payload.assignee,
    });
    ctx.emit({
      type: "TaskStarted",
      data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee },
    });
  });

  state.on("Rename", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
});
```

Multiple `.state()` calls for the same state are additive -- handlers and middleware accumulate.

## Multi-State Handlers

Register a handler that applies to multiple states by passing an array:

```ts
router.state(["Todo", "InProgress"] as const, (state) => {
  state.on("Rename", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
});
```

The `as const` assertion is required so TypeScript narrows the state union correctly.

## Wildcard Handlers

Handle a command regardless of current state with `.on("*", ...)`:

```ts
router.on("*", "Archive", (ctx) => {
  ctx.transition("Archived", { reason: ctx.command.payload.reason });
});
```

## Priority Order

When multiple registrations could match, the most specific wins:

1. **Single-state handler** -- highest priority
2. **Multi-state handler** -- checked if no single-state match
3. **Wildcard handler** -- fallback

```ts
// "Draft" + "Archive" -> uses specific handler
router.state("Draft", (s) => {
  s.on("Archive", (ctx) => { /* runs for Draft */ });
});

// ["Draft", "Review"] + "Archive" -> used for Review, not Draft
router.state(["Draft", "Review"] as const, (s) => {
  s.on("Archive", (ctx) => { /* runs for Review */ });
});

// "*" + "Archive" -> fallback for all other states
router.on("*", "Archive", (ctx) => { /* runs for Published, etc. */ });
```

## Composable Routers

Split handler registration across routers and compose them with `.use()`:

```ts
const draftRouter = new WorkflowRouter(taskWorkflow);
draftRouter.state("Draft", (state) => {
  state.on("SetTitle", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
  state.on("Submit", (ctx) => {
    ctx.transition("Review", {
      title: ctx.data.title,
      assignee: ctx.command.payload.assignee,
    });
  });
});

const reviewRouter = new WorkflowRouter(taskWorkflow);
reviewRouter.state("Review", (state) => {
  state.on("Approve", (ctx) => {
    ctx.transition("Published", {
      title: ctx.data.title,
      publishedAt: new Date(),
    });
  });
});

const router = new WorkflowRouter(taskWorkflow);
router.use(draftRouter);
router.use(reviewRouter);
```

Each child router must use the same workflow definition. The merge is eager -- changes to the child after `.use()` do not affect the parent.

### Handler Priority

When both parent and child register a handler for the same state + command, the parent's handler wins. Child handlers only fill in what the parent doesn't have.

### Middleware Ordering

The child's global middleware is appended after the parent's. State-scoped middleware from the child is appended after the parent's state-scoped middleware for the same state.

### Nested Composition

Routers can be nested arbitrarily:

```ts
const inner = new WorkflowRouter(taskWorkflow);
inner.state("Draft", (s) => {
  s.on("SetTitle", (ctx) => { ctx.update({ title: ctx.command.payload.title }); });
});

const middle = new WorkflowRouter(taskWorkflow);
middle.use(inner);

const outer = new WorkflowRouter(taskWorkflow);
outer.use(middle);
```

## Dispatching Commands

```ts
const result = await router.dispatch(workflow, {
  type: "Start",
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
  type: "Start",
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
