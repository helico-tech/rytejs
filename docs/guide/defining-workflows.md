# Defining Workflows

`defineWorkflow()` creates a workflow definition from a name and Zod schema configuration.

## Basic Definition

<<< @/snippets/guide/defining-workflows.ts#basic

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

Handlers raise errors with `error()`, which halts execution and rolls back all mutations:

<<< @/snippets/guide/defining-workflows.ts#handler-error

The caller gets a typed error back:

<<< @/snippets/guide/defining-workflows.ts#result-check

Defining errors upfront makes your workflow's failure modes explicit and discoverable -- they're part of the contract, not hidden inside handler logic.

## Creating Workflow Instances

`createWorkflow()` instantiates a workflow in a specific initial state. The data is validated against the state's schema.

<<< @/snippets/guide/defining-workflows.ts#create

Zod defaults apply -- `priority` defaults to `0` since we used `.default(0)` in the schema.

If the data doesn't match the schema, `createWorkflow()` throws:

<<< @/snippets/guide/defining-workflows.ts#create-throws

## Schema Accessors

The definition exposes methods to retrieve individual schemas at runtime:

<<< @/snippets/guide/defining-workflows.ts#accessors

Each throws if the name doesn't exist.

## Checking State Existence

<<< @/snippets/guide/defining-workflows.ts#has-state

## Complete 3-State Example

<<< @/snippets/guide/defining-workflows.ts#complete

This definition can be used with a `WorkflowRouter` to handle each command -- see [Routing Commands](/guide/routing-commands).
