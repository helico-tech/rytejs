# Executor Simplification Design

**Date:** 2026-03-20
**Status:** Approved
**Principle:** Everything is as minimal as possible with an elegant API for the developer.

## Problem

The executor layer has grown beyond its core responsibility. It ships a plugin system, optional store middleware, broadcast middleware, an HTTP layer, and transport clients — all in `@rytejs/core`. The executor should be a thin IO shell around the pure router: **load → dispatch → save**. Everything else is either premature abstraction or belongs in userland.

## Design

### API Surface

```ts
class WorkflowExecutor<TConfig extends WorkflowConfig> {
	constructor(router: WorkflowRouter<TConfig>, store: StoreAdapter)

	use(middleware: ExecutorMiddleware): this
	execute(
		id: string,
		command: { type: string; payload: unknown },
		options?: { expectedVersion?: number },
	): Promise<ExecutionResult>
}
```

Three members: constructor, `use()`, `execute()`.

- **Store is required** — an executor without persistence is just `router.dispatch()` with extra steps.
- **`expectedVersion` is optional** — client-side optimistic locking when needed.
- **No `create()`** — users call `definition.createWorkflow()` + `store.save()` directly. Creation is a one-liner that doesn't need a pipeline.
- **No hooks** — middleware is the single extension mechanism. One mechanism instead of two.
- **No plugins** — just functions that call `executor.use()`. No Symbol branding needed.

### Execution Flow

```
execute(id, command, options?):
  1. store.load(id) → not found? return error
  2. expectedVersion mismatch? return error (pre-middleware check)
  3. build context { id, command, stored }
  4. compose([...middleware, dispatchHandler])(ctx)
     └─ dispatchHandler: restore → router.dispatch → set snapshot + events
  5. catch unexpected errors → return { ok: false, category: "unexpected" }
  6. if ctx.snapshot → store.save(snapshot, expectedVersion=stored.version)
     └─ ConcurrencyConflictError → return conflict error
  7. return result
```

**Key design decision:** Load happens BEFORE middleware, save happens AFTER. This means:
- `ctx.stored` is always populated when middleware runs (never null)
- Middleware can guard dispatch based on workflow state (auth use case)
- Middleware can inspect results after `await next()` (onion model)
- Not-found and version-mismatch short-circuit before any middleware runs

### Types

```ts
// Context — single type, no discriminated union (no create operation)
interface ExecutorContext {
	readonly id: string;
	readonly command: { type: string; payload: unknown };
	readonly stored: StoredWorkflow;           // always loaded before middleware

	result: DispatchResult<WorkflowConfig> | { ok: false; error: ExecutorError } | null;
	snapshot: WorkflowSnapshot | null;
	events: Array<{ type: string; data: unknown }>;
}

// Middleware — Koa-style, same as router
type ExecutorMiddleware = (ctx: ExecutorContext, next: () => Promise<void>) => Promise<void>;

// Executor-specific errors (dropped "already_exists" — no create())
type ExecutorError =
	| { category: "not_found"; id: string }
	| { category: "conflict"; id: string; expectedVersion: number; actualVersion: number }
	| { category: "restore"; id: string; issues: unknown[] }
	| { category: "unexpected"; error: unknown; message: string };

// Result — same pattern as router's DispatchResult
type ExecutionResult =
	| { ok: true; snapshot: WorkflowSnapshot; version: number; events: Array<{ type: string; data: unknown }> }
	| { ok: false; error: PipelineError<WorkflowConfig> | ExecutorError };
```

### Store Interface (unchanged)

```ts
interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}

interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
	events?: Array<{ type: string; data: unknown }>;
}
```

`memoryStore()` and `ConcurrencyConflictError` remain as shipped utilities.

### Directory Rename: `engine/` → `store/`

The `engine/` directory is a leftover from the Engine → Executor rename. It holds `StoreAdapter`, `memoryStore`, and `ConcurrencyConflictError` — all store concepts. Rename to `store/` for clarity.

## What Gets Deleted

### Files deleted entirely

| File | Reason |
|------|--------|
| `executor/plugin.ts` | Plugin system removed |
| `executor/with-store.ts` | Store baked into executor |
| `executor/with-broadcast.ts` | Broadcast is userland |
| `executor/__tests__/plugin.test.ts` | Plugin system removed |
| `executor/__tests__/with-store.test.ts` | Store baked into executor |
| `executor/__tests__/with-broadcast.test.ts` | Broadcast is userland |
| `executor/__tests__/outbox.test.ts` | Outbox pattern is userland |
| `http/` directory | Opinionated HTTP layer removed |
| `transport/` directory | Client transports removed |

### Entry points removed from package.json

- `@rytejs/core/http`
- `@rytejs/core/transport`
- `@rytejs/core/transport/server`

### Exports removed from `@rytejs/core/executor`

- `ExecutorPlugin`, `defineExecutorPlugin`, `isExecutorPlugin`
- `withStore`, `withBroadcast`, `createSubscriberRegistry`
- `SubscriberRegistry`, `BroadcastMessage`
- `CreateContext`, `ExecuteContext` (replaced by single `ExecutorContext`)

### Documentation changes

| Action | Page |
|--------|------|
| Update | `docs/guide/executor.md` — new API, store required, no hooks/plugins |
| Update | `docs/guide/observability.md` — executor tracing via middleware, not hooks |
| Update | `docs/.vitepress/config.ts` — remove deleted pages from sidebar |
| Delete | `docs/guide/persistence.md` (withStore docs) |
| Delete | `docs/guide/http-api.md` |
| Delete | `docs/guide/real-time.md` |
| Delete | `docs/guide/transports.md` |
| Delete | `docs/guide/putting-it-together.md` |
| Delete | Related snippet files in `docs/snippets/` |

## What Stays

- `WorkflowExecutor` class (rewritten)
- `ExecutorContext`, `ExecutorMiddleware`, `ExecutionResult`, `ExecutorError` types (simplified)
- `StoreAdapter`, `StoredWorkflow`, `SaveOptions` interfaces
- `memoryStore()` factory
- `ConcurrencyConflictError`
- `store/` directory (renamed from `engine/`)
- Executor tests (rewritten for new API)
- `executor.md` guide (rewritten)

## Decisions Log

| Decision | Rationale |
|----------|-----------|
| Store is required constructor param | Executor without store is just `router.dispatch()` with overhead |
| No `create()` method | Creation is `createWorkflow()` + `store.save()` — doesn't need a pipeline |
| Middleware stays | Needed for state-dependent cross-cutting concerns (auth checks against stored workflow) |
| Hooks removed | Middleware can do everything hooks do — one mechanism instead of two |
| Plugin system removed | A plugin is just a function that calls `executor.use()` — no branding needed |
| Load before middleware | Ensures `ctx.stored` is always populated; not-found short-circuits before middleware |
| Save after middleware | Executor owns persistence; middleware doesn't need to worry about it |
| Transport/HTTP/broadcast deleted | Client code and opinionated HTTP layer don't belong in a workflow engine package |
| `engine/` renamed to `store/` | Contents are store concepts, not engine concepts; old name was a rename artifact |
