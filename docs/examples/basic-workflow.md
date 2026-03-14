# Basic Workflow

A complete task workflow with three states: `todo`, `inProgress`, and `done`.

## Define the Workflow

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@ryte/core";

const taskWorkflow = defineWorkflow("task", {
  states: {
    todo: z.object({ title: z.string(), priority: z.number().default(0) }),
    inProgress: z.object({ title: z.string(), assignee: z.string() }),
    done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
  },
  commands: {
    start: z.object({ assignee: z.string() }),
    complete: z.object({}),
    rename: z.object({ title: z.string() }),
  },
  events: {
    TaskStarted: z.object({ taskId: z.string(), assignee: z.string() }),
    TaskCompleted: z.object({ taskId: z.string() }),
    TaskRenamed: z.object({ taskId: z.string(), title: z.string() }),
  },
  errors: {},
});
```

## Create the Router

```ts
const router = new WorkflowRouter(taskWorkflow);

// todo: can be renamed or started
router.state("todo", (state) => {
  state.on("rename", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
    ctx.emit({
      type: "TaskRenamed",
      data: { taskId: ctx.workflow.id, title: ctx.command.payload.title },
    });
  });

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
});

// inProgress: can be completed
router.state("inProgress", (state) => {
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

## Dispatch Commands

```ts
// 1. Create a task
let task = taskWorkflow.createWorkflow("task-1", {
  initialState: "todo",
  data: { title: "Write documentation" },
});

console.log(task.state);      // "todo"
console.log(task.data.title); // "Write documentation"
```

### Rename the task

```ts
let result = await router.dispatch(task, {
  type: "rename",
  payload: { title: "Write complete documentation" },
});

if (result.ok) {
  task = result.workflow;
  console.log(task.state);      // "todo"
  console.log(task.data.title); // "Write complete documentation"
  console.log(result.events);   // [{ type: "TaskRenamed", data: { taskId: "task-1", title: "Write complete documentation" } }]
}
```

### Start the task

```ts
result = await router.dispatch(task, {
  type: "start",
  payload: { assignee: "alice" },
});

if (result.ok) {
  task = result.workflow;
  console.log(task.state); // "inProgress"
  console.log(task.data);  // { title: "Write complete documentation", assignee: "alice" }
  console.log(result.events[0]?.type); // "TaskStarted"
}
```

### Complete the task

```ts
result = await router.dispatch(task, {
  type: "complete",
  payload: {},
});

if (result.ok) {
  task = result.workflow;
  console.log(task.state); // "done"
  console.log(task.data);  // { title: "Write complete documentation", completedAt: Date }
  console.log(result.events[0]?.type); // "TaskCompleted"
}
```

## What's Happening

1. `defineWorkflow()` creates a definition with Zod schemas for states, commands, events, and errors.
2. `createWorkflow()` instantiates a workflow in an initial state, validating the data.
3. `WorkflowRouter` maps state + command pairs to handlers.
4. `ctx.update()` modifies data within the current state (validated).
5. `ctx.transition()` moves to a new state with new data (validated).
6. `ctx.emit()` records events (validated, accumulated per dispatch).
7. `router.dispatch()` returns the updated workflow and events, or an error.

Each dispatch is isolated -- the original workflow is never mutated, events don't carry over between dispatches, and errors trigger a full rollback.
