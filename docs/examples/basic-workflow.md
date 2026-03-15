# Basic Workflow

A complete task workflow with three states: `Todo`, `InProgress`, and `Done`.

## Define the Workflow

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";

const taskWorkflow = defineWorkflow("task", {
  states: {
    Todo: z.object({ title: z.string(), priority: z.number().default(0) }),
    InProgress: z.object({ title: z.string(), assignee: z.string() }),
    Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
  },
  commands: {
    Start: z.object({ assignee: z.string() }),
    Complete: z.object({}),
    Rename: z.object({ title: z.string() }),
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

All methods return `this`, so you can chain `.state()` calls fluently:

```ts
const router = new WorkflowRouter(taskWorkflow)
  .state("Todo", ({ on }) => {
    on("Rename", ({ command, update, emit, workflow }) => {
        update({ title: command.payload.title });
        emit({
          type: "TaskRenamed",
          data: { taskId: workflow.id, title: command.payload.title },
        });
      });
    on("Start", ({ data, command, transition, emit, workflow }) => {
        transition("InProgress", {
          title: data.title,
          assignee: command.payload.assignee,
        });
        emit({
          type: "TaskStarted",
          data: { taskId: workflow.id, assignee: command.payload.assignee },
        });
      });
  })
  .state("InProgress", ({ on }) => {
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

## Dispatch Commands

```ts
// 1. Create a task
let task = taskWorkflow.createWorkflow("task-1", {
  initialState: "Todo",
  data: { title: "Write documentation" },
});

console.log(task.state);      // "Todo"
console.log(task.data.title); // "Write documentation"
```

### Rename the task

```ts
let result = await router.dispatch(task, {
  type: "Rename",
  payload: { title: "Write complete documentation" },
});

if (result.ok) {
  task = result.workflow;
  console.log(task.state);      // "Todo"
  console.log(task.data.title); // "Write complete documentation"
  console.log(result.events);   // [{ type: "TaskRenamed", data: { taskId: "task-1", title: "Write complete documentation" } }]
}
```

### Start the task

```ts
result = await router.dispatch(task, {
  type: "Start",
  payload: { assignee: "alice" },
});

if (result.ok) {
  task = result.workflow;
  console.log(task.state); // "InProgress"
  console.log(task.data);  // { title: "Write complete documentation", assignee: "alice" }
  console.log(result.events[0]?.type); // "TaskStarted"
}
```

### Complete the task

```ts
result = await router.dispatch(task, {
  type: "Complete",
  payload: {},
});

if (result.ok) {
  task = result.workflow;
  console.log(task.state); // "Done"
  console.log(task.data);  // { title: "Write complete documentation", completedAt: Date }
  console.log(result.events[0]?.type); // "TaskCompleted"
}
```

## What's Happening

1. `defineWorkflow()` creates a definition with Zod schemas for states, commands, events, and errors.
2. `createWorkflow()` instantiates a workflow in an initial state, validating the data.
3. `WorkflowRouter` maps state + command pairs to handlers.
4. `update()` modifies data within the current state (validated).
5. `transition()` moves to a new state with new data (validated).
6. `emit()` records events (validated, accumulated per dispatch).
7. `router.dispatch()` returns the updated workflow and events, or an error.

Each dispatch is isolated -- the original workflow is never mutated, events don't carry over between dispatches, and errors trigger a full rollback.
