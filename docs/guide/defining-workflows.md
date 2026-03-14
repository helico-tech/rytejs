# Defining Workflows

`defineWorkflow()` creates a workflow definition from a name and Zod schema configuration.

## Basic Definition

```ts
import { z } from "zod";
import { defineWorkflow } from "@rytejs/core";

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
  },
  errors: {
    AlreadyAssigned: z.object({ currentAssignee: z.string() }),
  },
});
```

All four config keys -- `states`, `commands`, `events`, `errors` -- are required. Use `{}` for any you don't need yet.

## Defining Errors

Errors represent domain failures that handlers can raise. Define them upfront with Zod schemas so both the error code and its data are type-safe:

```ts
errors: {
  AlreadyAssigned: z.object({ currentAssignee: z.string() }),
  NotAssigned: z.object({}),
  DeadlinePassed: z.object({ deadline: z.coerce.date() }),
},
```

Handlers raise errors with `ctx.error()`, which halts execution and rolls back all mutations:

```ts
router.state("Todo", (state) => {
  state.on("Start", (ctx) => {
    if (!ctx.data.assignee) {
      ctx.error({ code: "NotAssigned", data: {} });
    }
    // only runs if no error was raised
    ctx.transition("InProgress", { ... });
  });
});
```

The caller gets a typed error back:

```ts
const result = await router.dispatch(task, { type: "Start", payload: {} });

if (!result.ok && result.error.category === "domain") {
  result.error.code; // "AlreadyAssigned" | "NotAssigned" | "DeadlinePassed"
  result.error.data; // typed based on the code
}
```

Defining errors upfront makes your workflow's failure modes explicit and discoverable -- they're part of the contract, not hidden inside handler logic.

## Creating Workflow Instances

`createWorkflow()` instantiates a workflow in a specific initial state. The data is validated against the state's schema.

```ts
const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "Todo",
  data: { title: "Write docs" },
});

console.log(task.id);    // "task-1"
console.log(task.state); // "Todo"
console.log(task.data);  // { title: "Write docs", priority: 0 }
```

Zod defaults apply -- `priority` defaults to `0` since we used `.default(0)` in the schema.

If the data doesn't match the schema, `createWorkflow()` throws:

```ts
// Throws: Invalid initial data for state 'Todo': Required
taskWorkflow.createWorkflow("bad", {
  initialState: "Todo",
  data: {}, // missing 'title'
});
```

## Schema Accessors

The definition exposes methods to retrieve individual schemas at runtime:

```ts
taskWorkflow.getStateSchema("Todo");       // ZodObject for Todo state
taskWorkflow.getCommandSchema("Start");    // ZodObject for Start command
taskWorkflow.getEventSchema("TaskStarted"); // ZodObject for TaskStarted event
taskWorkflow.getErrorSchema("AlreadyAssigned"); // ZodObject for error
```

Each throws if the name doesn't exist.

## Checking State Existence

```ts
taskWorkflow.hasState("Todo");      // true
taskWorkflow.hasState("unknown");   // false
```

## Complete 3-State Example

```ts
import { z } from "zod";
import { defineWorkflow } from "@rytejs/core";

const articleWorkflow = defineWorkflow("article", {
  states: {
    Draft: z.object({ title: z.string(), body: z.string().optional() }),
    Review: z.object({
      title: z.string(),
      body: z.string(),
      reviewerId: z.string(),
    }),
    Published: z.object({
      title: z.string(),
      body: z.string(),
      publishedAt: z.coerce.date(),
    }),
  },
  commands: {
    UpdateDraft: z.object({
      title: z.string().optional(),
      body: z.string().optional(),
    }),
    SubmitForReview: z.object({ reviewerId: z.string() }),
    Approve: z.object({}),
  },
  events: {
    DraftUpdated: z.object({ articleId: z.string() }),
    SubmittedForReview: z.object({
      articleId: z.string(),
      reviewerId: z.string(),
    }),
    ArticlePublished: z.object({ articleId: z.string() }),
  },
  errors: {
    BodyRequired: z.object({}),
  },
});
```

This definition can be used with a `WorkflowRouter` to handle each command -- see [Routing Commands](/guide/routing-commands).
