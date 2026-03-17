# Basic Workflow

A complete task workflow with three states: `Todo`, `InProgress`, and `Done`.

## Define the Workflow

<<< @/snippets/examples/basic-workflow.ts#define

## Create the Router

All methods return `this`, so you can chain `.state()` calls fluently:

<<< @/snippets/examples/basic-workflow.ts#router

## Dispatch Commands

<<< @/snippets/examples/basic-workflow.ts#create

### Rename the task

<<< @/snippets/examples/basic-workflow.ts#rename

### Start the task

<<< @/snippets/examples/basic-workflow.ts#start

### Complete the task

<<< @/snippets/examples/basic-workflow.ts#complete

## What's Happening

1. `defineWorkflow()` creates a definition with Zod schemas for states, commands, events, and errors.
2. `createWorkflow()` instantiates a workflow in an initial state, validating the data.
3. `WorkflowRouter` maps state + command pairs to handlers.
4. `update()` modifies data within the current state (validated).
5. `transition()` moves to a new state with new data (validated).
6. `emit()` records events (validated, accumulated per dispatch).
7. `router.dispatch()` returns the updated workflow and events, or an error.

Each dispatch is isolated -- the original workflow is never mutated, events don't carry over between dispatches, and errors trigger a full rollback.
