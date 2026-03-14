# State Transitions

Handlers modify workflow state through two methods: `ctx.update()` and `ctx.transition()`.

## Reading Current Data

`ctx.data` returns a copy of the current state data:

```ts
router.state("todo", (state) => {
  state.on("rename", (ctx) => {
    console.log(ctx.data.title); // current title
  });
});
```

This is a getter that returns a shallow copy each time -- mutations to the returned object have no effect.

## Updating Within the Same State

`ctx.update()` merges partial data into the current state. The merged result is validated against the current state's schema.

```ts
router.state("todo", (state) => {
  state.on("rename", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
    // State is still "todo", data.title is updated
  });
});
```

Only the fields you pass are merged. Existing fields are preserved:

```ts
// Before: { title: "Old", priority: 3 }
ctx.update({ title: "New" });
// After:  { title: "New", priority: 3 }
```

If the merged data fails validation, a validation error with `source: "state"` is returned.

## Transitioning to a New State

`ctx.transition()` moves the workflow to a different state with entirely new data. The data is validated against the target state's schema.

```ts
router.state("todo", (state) => {
  state.on("start", (ctx) => {
    ctx.transition("inProgress", {
      title: ctx.data.title,
      assignee: ctx.command.payload.assignee,
    });
  });
});
```

**Data is explicit.** There is no implicit carry-forward from the previous state. You must provide all required fields for the target state.

```ts
// This works -- all fields for "inProgress" are provided
ctx.transition("inProgress", {
  title: ctx.data.title,        // explicitly carried from current state
  assignee: "alice",
});

// This fails -- "assignee" is missing
ctx.transition("inProgress", {
  title: ctx.data.title,
});
```

If validation fails, a validation error with `source: "transition"` is returned.

## Update vs Transition

| Method         | Stays in state? | Data behavior                    | Validation against |
| -------------- | --------------- | -------------------------------- | ------------------ |
| `ctx.update()` | Yes             | Merges partial into current data | Current state      |
| `ctx.transition()` | No         | Replaces data entirely           | Target state       |

## Rollback on Error

All mutations are provisional. If a handler throws or calls `ctx.error()`, the original workflow is unchanged:

```ts
router.state("todo", (state) => {
  state.on("start", (ctx) => {
    ctx.update({ title: "Modified" });      // provisional
    ctx.error({ code: "notAllowed", data: {} }); // throws -- update is discarded
  });
});

const result = await router.dispatch(task, { type: "start", payload: { assignee: "x" } });
// result.ok === false
// task.data.title is still the original value
```

The dispatch operates on internal copies. The workflow object you passed in is never mutated.
