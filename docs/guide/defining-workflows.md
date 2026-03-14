# Defining Workflows

`defineWorkflow()` creates a workflow definition from a name and Zod schema configuration.

## Basic Definition

```ts
import { z } from "zod";
import { defineWorkflow } from "@ryte/core";

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
  },
  errors: {
    alreadyAssigned: z.object({ currentAssignee: z.string() }),
  },
});
```

All four config keys -- `states`, `commands`, `events`, `errors` -- are required. Use `{}` for any you don't need yet.

## Creating Workflow Instances

`createWorkflow()` instantiates a workflow in a specific initial state. The data is validated against the state's schema.

```ts
const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "todo",
  data: { title: "Write docs" },
});

console.log(task.id);    // "task-1"
console.log(task.state); // "todo"
console.log(task.data);  // { title: "Write docs", priority: 0 }
```

Zod defaults apply -- `priority` defaults to `0` since we used `.default(0)` in the schema.

If the data doesn't match the schema, `createWorkflow()` throws:

```ts
// Throws: Invalid initial data for state 'todo': Required
taskWorkflow.createWorkflow("bad", {
  initialState: "todo",
  data: {}, // missing 'title'
});
```

## Schema Accessors

The definition exposes methods to retrieve individual schemas at runtime:

```ts
taskWorkflow.getStateSchema("todo");       // ZodObject for todo state
taskWorkflow.getCommandSchema("start");    // ZodObject for start command
taskWorkflow.getEventSchema("TaskStarted"); // ZodObject for TaskStarted event
taskWorkflow.getErrorSchema("alreadyAssigned"); // ZodObject for error
```

Each throws if the name doesn't exist.

## Checking State Existence

```ts
taskWorkflow.hasState("todo");      // true
taskWorkflow.hasState("unknown");   // false
```

## Complete 3-State Example

```ts
import { z } from "zod";
import { defineWorkflow } from "@ryte/core";

const articleWorkflow = defineWorkflow("article", {
  states: {
    draft: z.object({ title: z.string(), body: z.string().optional() }),
    review: z.object({
      title: z.string(),
      body: z.string(),
      reviewerId: z.string(),
    }),
    published: z.object({
      title: z.string(),
      body: z.string(),
      publishedAt: z.coerce.date(),
    }),
  },
  commands: {
    updateDraft: z.object({
      title: z.string().optional(),
      body: z.string().optional(),
    }),
    submitForReview: z.object({ reviewerId: z.string() }),
    approve: z.object({}),
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
    bodyRequired: z.object({}),
  },
});
```

This definition can be used with a `WorkflowRouter` to handle each command -- see [Routing Commands](/guide/routing-commands).
