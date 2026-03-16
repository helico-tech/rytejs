# @rytejs/react — Design Spec

## Overview

A React integration package for @rytejs/core that exposes workflows as reactive state management stores. Built on `useSyncExternalStore` with a minimal API surface: one store factory, one context factory, one hook.

## Goals

- **Reactive state management** using @rytejs/core workflows as the store
- **Minimal API** — three runtime exports, one hook
- **Zero generic annotations** at call sites — TConfig inferred from the definition
- **Optimal re-renders** via selectors on `useSyncExternalStore`
- **Discriminated union narrowing** works natively (`workflow.state === "Draft"` narrows `workflow.data`)
- **Foundation for future sync** — the store abstraction supports persistence and server sync without breaking changes

## Non-Goals (v1)

- Server sync adapters (deferred to v2+ or `@rytejs/sync`)
- DevTools panel
- Form integration hooks (`useWorkflowForm`)
- Undo/redo history
- Offline command queue

## Package Structure

```
packages/react/
├── src/
│   ├── index.ts                 # Public exports
│   ├── store.ts                 # createWorkflowStore
│   ├── context.ts               # createWorkflowContext
│   ├── use-workflow.ts          # useWorkflow hook
│   └── types.ts                 # React-specific types
├── __tests__/
│   ├── store.test.ts
│   ├── use-workflow.test.ts
│   └── context.test.ts
├── package.json
└── tsup.config.ts
```

**Package name:** `@rytejs/react`
**Peer dependencies:** `react >=18`, `@rytejs/core`
**No runtime dependencies.** Built on React's built-in `useSyncExternalStore`.

## API Surface

### `createWorkflowStore(router, initialConfig, options?)`

Creates an external subscribable store that bridges the workflow engine and React.

The `definition` is accessed from the router internally (requires exposing `definition` as a readonly property on `WorkflowRouter` — minor core change). This avoids requiring consumers to pass the same definition twice.

```typescript
function createWorkflowStore<
	TConfig extends WorkflowConfig,
	TDeps,
	S extends StateNames<TConfig>,
>(
	router: WorkflowRouter<TConfig, TDeps>,
	initialConfig: {
		state: S;
		data: StateData<TConfig, S>; // Correlated: data shape must match the specified state
		id?: string; // If omitted, generated via crypto.randomUUID()
	},
	options?: WorkflowStoreOptions<TConfig>,
): WorkflowStore<TConfig>;
```

`S` is inferred from the `state` argument — no manual annotation needed. This mirrors `definition.createWorkflow()` and ensures TypeScript rejects mismatched `state`/`data` pairs at compile time.

**Options:**

```typescript
interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage; // localStorage or sessionStorage
		migrations?: MigrationPipeline<TConfig>; // For upgrading old snapshots
	};
}
```

**Store interface (internal, not typically used directly):**

```typescript
interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
}

interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig>;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	/**
	 * Replace the workflow directly. Used by sync adapters to apply server-pushed
	 * updates. Bypasses the router — caller is responsible for ensuring validity.
	 */
	setWorkflow(workflow: Workflow<TConfig>): void;
}
```

**Design notes:**

- `TDeps` is inferred from the router but intentionally not propagated to `WorkflowStore`. Dependency injection is a router concern, not a React concern.
- `dispatch(command, payload)` is a deliberate simplification of core's `router.dispatch(workflow, { type, payload })` — the store manages the workflow reference internally and wraps arguments into `{ type, payload }` before forwarding to the router.

**Behavior:**

- Holds the current `Workflow<TConfig>` instance
- `dispatch()` calls `router.dispatch()`, updates internal workflow on success, notifies subscribers
- `dispatch()` updates `isDispatching` and `error` state atomically with workflow changes — one notification, one render pass
- `getSnapshot()` returns a composite `WorkflowStoreSnapshot` — the unit of React subscription
- Errors are reported in two ways: the returned `Promise<DispatchResult>` (imperative) and `error` on the store snapshot (reactive). `error` clears on the next successful dispatch.
- If `persist` is configured:
  - On creation: checks storage for existing snapshot → `definition.restore()` → uses if valid, falls back to initial
  - If `persist.migrations` is provided and `modelVersion` is stale, runs `migrate()` before `restore()`
  - After successful dispatch: `definition.snapshot()` → saves to storage

### `createWorkflowContext(definition)`

Factory that returns a typed Provider component and a pre-bound `useWorkflow` hook. Eliminates generic parameters at every call site.

`TConfig` is inferred from the `definition` argument. The definition is only used for type inference — it has no runtime role in the context. The Provider accepts any `WorkflowStore<TConfig>` — type compatibility is enforced at compile time.

```typescript
function createWorkflowContext<TConfig extends WorkflowConfig>(
	definition: WorkflowDefinition<TConfig>,
): {
	Provider: React.FC<{ store: WorkflowStore<TConfig>; children: ReactNode }>;
	useWorkflow: {
		(): UseWorkflowReturn<TConfig>;
		<R>(selector: (workflow: Workflow<TConfig>) => R, equalityFn?: (a: R, b: R) => boolean): R;
	};
};
```

**Usage:**

```typescript
// order-workflow.ts — define once per workflow type
export const OrderWorkflow = createWorkflowContext(orderDefinition);

// App.tsx — provide the store
<OrderWorkflow.Provider store={orderStore}>
	<OrderPage />
</OrderWorkflow.Provider>

// Any descendant — zero generics
const wf = OrderWorkflow.useWorkflow();
```

### `useWorkflow` (standalone)

For single-component use without a Provider. Accepts the store directly.

```typescript
function useWorkflow<TConfig extends WorkflowConfig>(
	store: WorkflowStore<TConfig>,
): UseWorkflowReturn<TConfig>;

function useWorkflow<TConfig extends WorkflowConfig, R>(
	store: WorkflowStore<TConfig>,
	selector: (workflow: Workflow<TConfig>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): R;
```

### `UseWorkflowReturn<TConfig>`

The object returned by `useWorkflow()` when called without a selector:

```typescript
interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	/** Full workflow instance — discriminated union, narrows on .state check */
	readonly workflow: Workflow<TConfig>;

	/**
	 * Shorthand for workflow.state.
	 * Union type — for state-specific logic, use `workflow` with narrowing or `match()`.
	 */
	readonly state: StateNames<TConfig>;

	/**
	 * Shorthand for workflow.data.
	 * Union of all state data types — for state-specific access, use `workflow` with
	 * narrowing or `match()` instead.
	 */
	readonly data: StateData<TConfig, StateNames<TConfig>>;

	/** Whether a dispatch is currently in flight */
	readonly isDispatching: boolean;

	/** Error from the last failed dispatch, null if last dispatch succeeded */
	readonly error: PipelineError<TConfig> | null;

	/** Dispatch a command. Stable reference — never changes between renders. */
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;

	/** Exhaustive pattern matching on workflow state */
	match<R>(
		matchers: {
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		},
	): R;

	/** Partial pattern matching with fallback */
	match<R>(
		matchers: Partial<{
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		}>,
		fallback: (workflow: Workflow<TConfig>) => R,
	): R;
}
```

## TypeScript Inference Strategy

### TConfig Inference

`TConfig` is inferred from the `WorkflowDefinition<TConfig>` argument passed to `createWorkflowContext(definition)`, or from the `WorkflowStore<TConfig>` passed to `useWorkflow(store)`. Both `createWorkflowStore` and `createWorkflowContext` infer `TConfig` from their arguments. Consumers never write `<TConfig>` manually.

### Discriminated Union Narrowing

The `workflow` property is `Workflow<TConfig>` — the same mapped union type from core:

```typescript
type Workflow<TConfig> = {
	[S in StateNames<TConfig>]: WorkflowOf<TConfig, S>;
}[StateNames<TConfig>];
```

Standard `if (workflow.state === "Draft")` checks narrow `workflow.data` automatically. No wrapper types that break this pattern.

### Correlated Dispatch Typing

`dispatch<C>(command: C, payload: CommandPayload<TConfig, C>)` — TypeScript infers `C` from the first argument and constrains the second. Provides autocomplete on command names and type-checks payload shapes per command.

### IDE Performance

- Lean on core's `_resolved` + `Prettify<T>` pattern — tooltips show concrete types
- Simple overload on `dispatch` (non-variadic) resolves fast in both VSCode and WebStorm
- No conditional types on `TConfig` in the React package
- No `UnionToIntersection` or other heavy utility types

### Selector Typing

Selectors operate on `Workflow<TConfig>` (the full discriminated union), not the full `UseWorkflowReturn`. This means selectors are for optimizing re-renders on workflow data — `isDispatching` and `error` are always available via the full `useWorkflow()` form. For state-specific data, consumers narrow inside the selector:

```typescript
// Common field
const title = useWorkflow(w => w.data.title);

// State-specific field
const reviewerId = useWorkflow(w =>
	w.state === "Review" ? w.data.reviewerId : null
);
```

## Re-render Optimization

### Foundation: `useSyncExternalStore`

All reactive subscriptions go through `useSyncExternalStore`. This provides:
- Tearing prevention in concurrent mode
- SSR support via `getServerSnapshot` (returns the initial workflow state passed to `createWorkflowStore` — server-rendered components always see the initial state; hydration picks up any persisted state on the client)
- No dependency on `useState` + `useEffect` (which can cause stale reads)

### Full Mode vs. Selector Mode

- **`useWorkflow()`** — subscribes to the full store snapshot. Re-renders on any change (workflow, isDispatching, error). Fine for most components.
- **`useWorkflow(selector)`** — subscribes to a computed slice. Re-renders only when the selector return value changes (default: `Object.is` comparison, custom equality function optional).

### Stable Dispatch Reference

The `dispatch` function is created once per store and never changes. It's safe to pass as a prop, use in `useEffect` deps, or pass to child components without causing re-renders.

### Atomic Updates

When a dispatch completes, `workflow`, `isDispatching`, and `error` are updated in a single store notification — one render pass, not three.

## Persistence (v1)

### localStorage Adapter

Configured via `createWorkflowStore` options:

```typescript
const store = createWorkflowStore(router, {
	state: "Draft",
	data: { title: "", body: "" },
}, {
	persist: {
		key: "order-draft-123",
		storage: localStorage,
	},
});
```

**Behavior:**
1. On store creation: read `storage.getItem(key)`
2. If found: `JSON.parse` → `definition.restore(snapshot)`
3. If restore succeeds: use restored workflow as initial state
4. If restore fails (validation error, missing key, corrupt data): use provided initial config
5. After each successful dispatch: `definition.snapshot(workflow)` → `storage.setItem(key, JSON.stringify(snapshot))`

### Migration Support

If the stored snapshot has an older `modelVersion` and the consumer provides a `MigrationPipeline`, the store runs `migrate()` before `restore()`.

## Future Sync (v2+)

The store abstraction is designed to support server sync without breaking changes:

```typescript
const store = createWorkflowStore(router, initial, {
	sync: {
		sendCommand: (command) => fetch("/api/dispatch", { ... }),
		subscribe: (onUpdate) => { /* WebSocket/SSE/polling */ },
	},
});
```

The store would handle:
1. Optimistic local dispatch (immediate UI update)
2. Send command to server
3. Reconcile on server response (usually a no-op since both run the same router)
4. Apply pushed updates from other clients
5. Roll back on server rejection

This is not implemented in v1 but the store interface supports it.

## Exported Types

In addition to the three runtime exports, the following types are exported for consumer type annotations:

- `WorkflowStore<TConfig>` — the store interface
- `WorkflowStoreSnapshot<TConfig>` — composite snapshot (workflow + isDispatching + error)
- `WorkflowStoreOptions<TConfig>` — store creation options
- `UseWorkflowReturn<TConfig>` — the hook return type

## Core Changes Required

### `WorkflowRouter.definition` (required for v1)

Expose the definition as a public readonly property on `WorkflowRouter` so the store can access it without requiring consumers to pass it separately:

```typescript
class WorkflowRouter<TConfig, TDeps> {
	readonly definition: WorkflowDefinition<TConfig>;
	// ...
}
```

### `WorkflowRouter.canDispatch` (deferred)

The `WorkflowRouter` currently has no public method to check if a handler exists for a given state + command combination. While not blocking for v1, a future `useCanDispatch` feature would need:

```typescript
// Addition to WorkflowRouter
canDispatch(state: StateNames<TConfig>, command: CommandNames<TConfig>): boolean;
```

This is deferred — not needed for the initial release.

## Testing Strategy

- Unit tests with Vitest + React Testing Library (`@testing-library/react`)
- Test the store independently (vanilla JS, no React)
- Test hooks via `renderHook` from React Testing Library
- Test context/provider integration with component renders
- Type-level tests for inference (using `expectTypeOf` from vitest)

## Example Usage

```typescript
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { createWorkflowStore, createWorkflowContext } from "@rytejs/react";
import { z } from "zod";

// --- Define workflow (shared between client/server) ---
const definition = defineWorkflow("todo", {
	states: {
		Pending: z.object({ title: z.string(), description: z.string().optional() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
	},
	events: {
		TodoStarted: z.object({ assignee: z.string() }),
		TodoCompleted: z.object({ todoId: z.string() }),
	},
	errors: {
		AlreadyAssigned: z.object({ currentAssignee: z.string() }),
	},
});

// --- Set up router with handlers ---
const router = new WorkflowRouter(definition);

router.state("Pending", ({ on }) => {
	on("Start", ({ command, transition, emit }) => {
		transition("InProgress", {
			title: "My Todo",
			assignee: command.payload.assignee,
		});
		emit({ type: "TodoStarted", data: { assignee: command.payload.assignee } });
	});
});

router.state("InProgress", ({ on }) => {
	on("Complete", ({ workflow, transition, emit }) => {
		transition("Done", {
			title: workflow.data.title,
			completedAt: new Date(),
		});
		emit({ type: "TodoCompleted", data: { todoId: workflow.id } });
	});
});

// --- React integration ---
const TodoWorkflow = createWorkflowContext(definition);

const store = createWorkflowStore(router, {
	state: "Pending",
	data: { title: "Buy groceries" },
});

function App() {
	return (
		<TodoWorkflow.Provider store={store}>
			<TodoView />
		</TodoWorkflow.Provider>
	);
}

function TodoView() {
	const wf = TodoWorkflow.useWorkflow();

	return wf.match({
		Pending: (data) => (
			<div>
				<h1>{data.title}</h1>
				<button
					onClick={() => wf.dispatch("Start", { assignee: "Alice" })}
					disabled={wf.isDispatching}
				>
					Start
				</button>
			</div>
		),
		InProgress: (data) => (
			<div>
				<h1>{data.title}</h1>
				<p>Assigned to {data.assignee}</p>
				<button
					onClick={() => wf.dispatch("Complete", {})}
					disabled={wf.isDispatching}
				>
					Complete
				</button>
			</div>
		),
		Done: (data) => (
			<div>
				<h1>{data.title} ✓</h1>
				<p>Completed at {data.completedAt.toLocaleString()}</p>
			</div>
		),
	});
}

// --- Selective re-renders ---
function TodoTitle() {
	// Only re-renders when title changes, not on state transitions
	const title = TodoWorkflow.useWorkflow((w) => w.data.title);
	return <h1>{title}</h1>;
}

function TodoStatus() {
	// Only re-renders when state changes
	const state = TodoWorkflow.useWorkflow((w) => w.state);
	return <span className={`badge-${state.toLowerCase()}`}>{state}</span>;
}
```
