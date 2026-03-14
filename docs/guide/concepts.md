# Concepts

Ryte is a state machine engine where Zod schemas define the shape of everything. Here's how the pieces fit together.

## Workflow

An immutable snapshot of a stateful entity. Every workflow has:

| Field            | Description                              |
| ---------------- | ---------------------------------------- |
| `id`             | Unique identifier (you provide this)     |
| `definitionName` | Name of the workflow definition          |
| `state`          | Current state name (e.g. `"Todo"`)       |
| `data`           | State-specific data, validated by Zod    |
| `createdAt`      | Creation timestamp                       |
| `updatedAt`      | Last modification timestamp              |

Workflows are never mutated directly. You dispatch commands and get back a new snapshot.

## States

Each state has a Zod schema that defines its data shape. Different states can have entirely different data.

```ts
states: {
  Todo: z.object({ title: z.string() }),
  Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
}
```

When you check `workflow.state`, TypeScript narrows `workflow.data` to the matching schema automatically.

## Commands

Commands are intents dispatched to a workflow. Each command has a payload validated by its Zod schema before any handler runs.

```ts
commands: {
  Complete: z.object({}),
  Rename: z.object({ title: z.string() }),
}
```

Commands are dispatched as `{ type: "Complete", payload: {} }`.

## Events

Events are side effects emitted by handlers during dispatch. They are schema-validated and accumulated per dispatch -- they never leak between dispatches.

```ts
events: {
  TaskCompleted: z.object({ taskId: z.string() }),
}
```

Handlers emit events with `ctx.emit({ type: "TaskCompleted", data: { taskId: "..." } })`. Events are returned in `result.events` after a successful dispatch.

## Middleware

Koa-style onion model. Middleware wraps handlers and can run logic before and after. Three scopes: global, state-scoped, and inline.

```ts
router.use(async (ctx, next) => {
  console.log("before");
  await next();
  console.log("after");
});
```

## Dispatch Cycle

Every `router.dispatch(workflow, command)` follows this pipeline:

```
Command In
    |
    v
[Validate command payload against schema]
    |
    v
[Route: find handler by state + command]
    |
    v
[Global middleware -- before]
    |
    v
[State middleware -- before]
    |
    v
[Inline middleware -- before]
    |
    v
[Handler executes]
    |
    v
[Inline middleware -- after]
    |
    v
[State middleware -- after]
    |
    v
[Global middleware -- after]
    |
    v
Result Out (ok: true + workflow + events)
   or
Error Out  (ok: false + error)
```

If any step throws or returns a domain error, all mutations are discarded and the original workflow is unchanged.

## Summary

| Concept    | Role                                    |
| ---------- | --------------------------------------- |
| Workflow   | Immutable state snapshot                |
| State      | Zod schema defining data shape          |
| Command    | Intent dispatched to trigger logic      |
| Event      | Side effect emitted during dispatch     |
| Middleware | Pipeline wrapping handlers (onion)      |
| Handler    | Function that processes a command       |
| Router     | Maps state + command to handler         |
