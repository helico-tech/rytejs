# React

Use `@rytejs/react` to drive React UI from workflow state. The package provides a reactive store, a `useWorkflow` hook, state matching, selector-based re-renders, and a context API for prop-drilling-free access.

## Installation

```bash
pnpm add @rytejs/react @rytejs/core zod react
```

> `@rytejs/react` has peer dependencies on `@rytejs/core` and `react >= 18`.

## Creating a Store

`createWorkflowStore` wraps a `WorkflowRouter` and an initial state into a reactive store that tracks the current workflow, dispatching status, and errors.

<<< @/snippets/guide/react.ts#create-store

The store exposes:

| Method | Description |
| ------ | ----------- |
| `getWorkflow()` | Returns the current `Workflow<TConfig>` |
| `getSnapshot()` | Returns `{ workflow, isDispatching, error }` |
| `subscribe(listener)` | Registers a change listener; returns an unsubscribe function |
| `dispatch(command, payload)` | Dispatches a command through the router |
| `setWorkflow(workflow)` | Replaces the workflow directly (for server-pushed updates) |

## useWorkflow Hook

Inside a React component, `useWorkflow(store)` subscribes to the store and returns a reactive object. The component re-renders whenever the workflow, dispatching status, or error changes.

<<< @/snippets/guide/react.ts#use-workflow-hook

## State Matching

`match()` provides type-safe branching over workflow states -- similar to pattern matching. The callback for each state receives the correctly typed `data` and `workflow`.

<<< @/snippets/guide/react.ts#match

**Exhaustive match** requires a handler for every state. The compiler will error if you forget one.

**Partial match** handles only the states you care about. The fallback receives the full `Workflow<TConfig>` and runs for any unhandled state.

## Selector Mode

When you only need a slice of the workflow, pass a selector function as the second argument. The component only re-renders when the selected value changes (compared with `Object.is` by default).

<<< @/snippets/guide/react.ts#selector

For object selections, provide a custom equality function as the third argument to avoid unnecessary re-renders.

## Context API

`createWorkflowContext` creates a scoped React context so any descendant component can access the store without prop drilling.

<<< @/snippets/guide/react.ts#context

The returned `useWorkflow` supports both full mode and selector mode, just like the standalone hook.

## Persistence

Pass a `persist` option to `createWorkflowStore` to automatically save the workflow snapshot to `localStorage` (or any `Storage`-compatible backend) after each successful dispatch. On next load, the store restores from storage instead of using the initial config.

<<< @/snippets/guide/react.ts#persistence

If the stored data is from an older `modelVersion`, pass a `migrations` pipeline:

```ts
import { defineMigrations } from "@rytejs/core";

const migrations = defineMigrations(taskWorkflow, {
	2: (snap) => ({
		...snap,
		data: { ...snap.data, priority: 0 },
	}),
});

const store = createWorkflowStore(
	router,
	{ state: "Todo", data: { title: "Migrated task", priority: 0 } },
	{
		persist: {
			key: "task-workflow",
			storage: localStorage,
			migrations,
		},
	},
);
```

See [Migrations](/guide/migrations) for details on defining migration pipelines.

## Transport

Use `createWorkflowClient` to connect to a server-backed workflow. Commands dispatch through the server, and broadcasts push updates back to the client.

<<< @/snippets/guide/react.ts#transport-store

Transport mode requires an `id` — the server needs to know which workflow to operate on.

### Real-time Updates

The client automatically subscribes to server broadcasts. Incoming updates replace the local workflow state and trigger re-renders.

### Cleanup

Call `cleanup()` to unsubscribe from the transport when the store is no longer needed:

<<< @/snippets/guide/react.ts#transport-cleanup

## Next Steps

- [Error Handling](/guide/error-handling) -- handle dispatch failures in the UI
- [Serialization](/guide/serialization) -- understand snapshots and restore
- [Migrations](/guide/migrations) -- evolve stored workflow data over time
- [Testing](/guide/testing) -- test workflows with `@rytejs/testing`
