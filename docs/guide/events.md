# Events

Events are side effects emitted during dispatch. They are schema-validated, accumulated per dispatch, and returned in the result.

## Emitting Events

Use `ctx.emit()` inside a handler. The event data is validated against the event's Zod schema.

```ts
router.state("todo", (state) => {
  state.on("complete", (ctx) => {
    ctx.transition("done", {
      title: ctx.data.title,
      completedAt: new Date(),
    });
    ctx.emit({
      type: "TaskCompleted",
      data: { taskId: ctx.workflow.id },
    });
  });
});
```

You can emit multiple events in a single handler:

```ts
state.on("start", (ctx) => {
  ctx.transition("inProgress", {
    title: ctx.data.title,
    assignee: ctx.command.payload.assignee,
  });
  ctx.emit({ type: "TaskStarted", data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee } });
  ctx.emit({ type: "AssigneeNotified", data: { assignee: ctx.command.payload.assignee } });
});
```

## Reading Events After Dispatch

Events are returned in `result.events` on success:

```ts
const result = await router.dispatch(task, { type: "complete", payload: {} });

if (result.ok) {
  for (const event of result.events) {
    console.log(event.type, event.data);
    // "TaskCompleted" { taskId: "task-1" }
  }
}
```

## Schema Validation

Event data must match the schema defined in the workflow. If it doesn't, dispatch fails with a validation error:

```ts
const workflow = defineWorkflow("task", {
  // ...
  events: {
    TaskCompleted: z.object({ taskId: z.string() }),
  },
  // ...
});

// In a handler:
ctx.emit({ type: "TaskCompleted", data: { taskId: 123 } }); // fails -- taskId must be string
```

This produces a validation error with `source: "event"`.

## Per-Dispatch Isolation

Each dispatch starts with an empty events list. Events from one dispatch never appear in another.

```ts
const r1 = await router.dispatch(task, { type: "start", payload: { assignee: "alice" } });
// r1.events: [{ type: "TaskStarted", ... }]

const r2 = await router.dispatch(r1.workflow, { type: "complete", payload: {} });
// r2.events: [{ type: "TaskCompleted", ... }]
// TaskStarted is NOT in r2.events
```

## Handling Events

Ryte does not prescribe how you handle events after dispatch. Common patterns:

```ts
const result = await router.dispatch(workflow, command);

if (result.ok) {
  for (const event of result.events) {
    switch (event.type) {
      case "TaskCompleted":
        await sendNotification(event.data);
        break;
      case "TaskStarted":
        await updateDashboard(event.data);
        break;
    }
  }
}
```

Events are data -- publish them to a message bus, write them to an event store, or handle them inline. Ryte gives you validated, typed events and lets you decide what to do with them.
