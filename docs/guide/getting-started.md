# Getting Started

Install Ryte and have a working workflow in under 2 minutes.

## Installation

```bash
pnpm add @rytejs/core zod
```

> **Note:** Ryte requires Zod v4 or later as a peer dependency.

## Define a Workflow

A workflow has states (Zod schemas), commands (intents that trigger logic), events (side effects), and errors (typed domain failures).

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";

const taskWorkflow = defineWorkflow("task", {
  states: {
    Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
    Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
  },
  commands: {
    Complete: z.object({}),
  },
  events: {
    TaskCompleted: z.object({ taskId: z.string() }),
  },
  errors: {
    NotAssigned: z.object({}),
  },
});
```

All four config keys -- `states`, `commands`, `events`, `errors` -- are required. Errors define your domain failures upfront so they're part of the contract, not hidden inside handlers.

## Create a Router and Handle Commands

All methods return `this`, so you can chain `.state()` and `.on()` calls fluently:

```ts
const router = new WorkflowRouter(taskWorkflow)
  .state("Todo", ({ on }) => {
    on("Complete", ({ data, error, transition, emit, workflow }) => {
      if (!data.assignee) {
        error({ code: "NotAssigned", data: {} });
      }
      transition("Done", {
        title: data.title,
        completedAt: new Date(),
      });
      emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
    });
  });
```

`error()` halts execution and rolls back all mutations. The error code and data are validated against the schema you defined.

## Dispatch and Check the Result

```ts
const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "Todo",
  data: { title: "Read the docs", assignee: "alice" },
});

const result = await router.dispatch(task, {
  type: "Complete",
  payload: {},
});

if (result.ok) {
  console.log(result.workflow.state); // "Done"
  console.log(result.events[0]?.type); // "TaskCompleted"
} else if (result.error.category === "domain") {
  console.log(result.error.code); // "NotAssigned"
}
```

`result.ok` is `true` when the command succeeds. The returned `workflow` is the updated snapshot, and `events` contains all events emitted during the dispatch. When `result.ok` is `false`, `result.error` tells you what went wrong -- validation failure, domain error, or missing handler.

## Next Steps

- [Concepts](/guide/concepts) -- understand the mental model
- [Defining Workflows](/guide/defining-workflows) -- schemas, states, commands in depth
- [Routing Commands](/guide/routing-commands) -- handlers, wildcards, multi-state
