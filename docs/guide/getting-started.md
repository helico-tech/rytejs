# Getting Started

Install Ryte and have a working workflow in under 2 minutes.

## Installation

```bash
pnpm add @rytejs/core zod
```

## Define a Workflow

A workflow has states (Zod schemas), commands (intents that trigger logic), events (side effects), and errors (typed domain failures).

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";

const taskWorkflow = defineWorkflow("task", {
  states: {
    Todo: z.object({ title: z.string() }),
    Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
  },
  commands: {
    Complete: z.object({}),
  },
  events: {
    TaskCompleted: z.object({ taskId: z.string() }),
  },
  errors: {},
});
```

## Create a Router and Handle Commands

```ts
const router = new WorkflowRouter(taskWorkflow);

router.state("Todo", (state) => {
  state.on("Complete", (ctx) => {
    ctx.transition("Done", {
      title: ctx.data.title,
      completedAt: new Date(),
    });
    ctx.emit({ type: "TaskCompleted", data: { taskId: ctx.workflow.id } });
  });
});
```

## Dispatch and Check the Result

```ts
const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "Todo",
  data: { title: "Read the docs" },
});

const result = await router.dispatch(task, {
  type: "Complete",
  payload: {},
});

if (result.ok) {
  console.log(result.workflow.state); // "Done"
  console.log(result.events[0]?.type); // "TaskCompleted"
}
```

`result.ok` is `true` when the command succeeds. The returned `workflow` is the updated snapshot, and `events` contains all events emitted during the dispatch.

## Next Steps

- [Concepts](/guide/concepts) -- understand the mental model
- [Defining Workflows](/guide/defining-workflows) -- schemas, states, commands in depth
- [Routing Commands](/guide/routing-commands) -- handlers, wildcards, multi-state
