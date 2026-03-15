# State Transitions

Handlers modify workflow state through two methods: `update()` and `transition()`.

## Reading Current Data

`data` holds the current state data:

```ts
router.state("Todo", ({ on }) => {
  on("Rename", ({ data }) => {
    console.log(data.title); // current title
  });
});
```

This is a getter that returns a shallow copy each time -- mutations to the returned object have no effect.

## Updating Within the Same State

`update()` merges partial data into the current state. The merged result is validated against the current state's schema.

```ts
router.state("Todo", ({ on }) => {
  on("Rename", ({ command, update }) => {
    update({ title: command.payload.title });
    // State is still "Todo", data.title is updated
  });
});
```

Only the fields you pass are merged. Existing fields are preserved:

```ts
// Before: { title: "Old", priority: 3 }
update({ title: "New" });
// After:  { title: "New", priority: 3 }
```

If the merged data fails validation, a validation error with `source: "state"` is returned.

## Transitioning to a New State

`transition()` moves the workflow to a different state with entirely new data. The data is validated against the target state's schema.

```ts
router.state("Todo", ({ on }) => {
  on("Start", ({ data, command, transition }) => {
    transition("InProgress", {
      title: data.title,
      assignee: command.payload.assignee,
    });
  });
});
```

**Data is explicit.** There is no implicit carry-forward from the previous state. You must provide all required fields for the target state.

```ts
// This works -- all fields for "InProgress" are provided
transition("InProgress", {
  title: data.title,        // explicitly carried from current state
  assignee: "alice",
});

// This fails -- "assignee" is missing
transition("InProgress", {
  title: data.title,
});
```

If validation fails, a validation error with `source: "transition"` is returned.

## Update vs Transition

| Method        | Stays in state? | Data behavior                    | Validation against |
| ------------- | --------------- | -------------------------------- | ------------------ |
| `update()`    | Yes             | Merges partial into current data | Current state      |
| `transition()` | No             | Replaces data entirely           | Target state       |

## Rollback on Error

All mutations are provisional. If a handler throws or calls `error()`, the original workflow is unchanged:

```ts
router.state("Todo", ({ on }) => {
  on("Start", ({ update, error }) => {
    update({ title: "Modified" });      // provisional
    error({ code: "NotAllowed", data: {} }); // throws -- update is discarded
  });
});

const result = await router.dispatch(task, { type: "Start", payload: { assignee: "x" } });
// result.ok === false
// task.data.title is still the original value
```

The dispatch operates on internal copies. The workflow object you passed in is never mutated.
