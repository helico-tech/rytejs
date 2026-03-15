# Events

Events are side effects emitted during dispatch. They are schema-validated, accumulated per dispatch, and returned in the result.

## Emitting Events

Use `emit()` inside a handler. The event data is validated against the event's Zod schema.

```ts
router.state("Todo", ({ on }) => {
  on("Complete", ({ data, transition, emit, workflow }) => {
    transition("Done", {
      title: data.title,
      completedAt: new Date(),
    });
    emit({
      type: "TaskCompleted",
      data: { taskId: workflow.id },
    });
  });
});
```

You can emit multiple events in a single handler:

```ts
on("Start", ({ data, command, transition, emit, workflow }) => {
  transition("InProgress", {
    title: data.title,
    assignee: command.payload.assignee,
  });
  emit({ type: "TaskStarted", data: { taskId: workflow.id, assignee: command.payload.assignee } });
  emit({ type: "AssigneeNotified", data: { assignee: command.payload.assignee } });
});
```

## Reading Events After Dispatch

Events are returned in `result.events` on success:

```ts
const result = await router.dispatch(task, { type: "Complete", payload: {} });

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
emit({ type: "TaskCompleted", data: { taskId: 123 } }); // fails -- taskId must be string
```

This produces a validation error with `source: "event"`.

## Per-Dispatch Isolation

Each dispatch starts with an empty events list. Events from one dispatch never appear in another.

```ts
const r1 = await router.dispatch(task, { type: "Start", payload: { assignee: "alice" } });
// r1.events: [{ type: "TaskStarted", ... }]

const r2 = await router.dispatch(r1.workflow, { type: "Complete", payload: {} });
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
