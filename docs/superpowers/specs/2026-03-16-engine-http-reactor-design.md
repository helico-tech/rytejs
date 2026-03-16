# @rytejs/core — Engine, HTTP, and Reactor Subpath Exports

## Problem

`@rytejs/core` is a single-dispatch engine: give it a workflow + command, get a result. Every production user writes the same boilerplate: load a snapshot from a database, restore the workflow, dispatch a command, snapshot the result, save it back, handle concurrency. This load-dispatch-save cycle is identical across HTTP servers, queue workers, CLI tools, and test harnesses.

There is no standard way to expose ryte workflows over HTTP, no persistence abstraction, no concurrency control, and no type-safe event-to-command mapping. Each user builds these from scratch.

## Solution

Extend `@rytejs/core` with three subpath exports that provide the missing layers:

- **`@rytejs/core/engine`** — the load-dispatch-save lifecycle with a `StoreAdapter` interface, in-process locking, and optimistic concurrency.
- **`@rytejs/core/http`** — a standards-compliant `(Request) => Promise<Response>` handler that binds the engine to the Fetch API.
- **`@rytejs/core/reactor`** — type-safe, pure event-to-command mapping with no execution logic.

These are subpath exports of core, not separate packages. They add zero external dependencies. Tree-shaking ensures consumers pay nothing for modules they don't import.

## Prerequisites

**Core change required:** `WorkflowRouter.definition` must become a public readonly property. The engine needs access to `definition.restore()`, `definition.snapshot()`, `definition.createWorkflow()`, and `definition.name`. This is a minor semver change — exposing what already exists. This also satisfies the worker spec's prerequisite (`definitionName`) since `router.definition.name` provides the same value.

**Recommended core change:** Export a `ConfigOf<R>` utility type that extracts `TConfig` from a `WorkflowRouter<TConfig>`. Saves every downstream consumer from writing `R extends WorkflowRouter<infer C, any> ? C : never`.

## Design

### `@rytejs/core/engine`

The engine owns the load-dispatch-save lifecycle. It wraps core's pure `dispatch()` with persistence, locking, and concurrency control.

#### StoreAdapter

```ts
interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number; // write-version for optimistic concurrency — distinct from definitionVersion
}

interface EmittedEvent {
	type: string;
	data: unknown;
}

interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	events: EmittedEvent[];
	expectedVersion: number;
}

interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}
```

- `save()` receives the snapshot and events together so store implementations that support transactions (Postgres, SQLite) can persist both atomically in one write. The store increments `version` on each successful save.
- `save()` throws `ConcurrencyConflictError` if `expectedVersion` doesn't match the stored version. This is the only typed error the store contract defines.
- When `expectedVersion` is 0, the store treats this as a create — no prior record should exist. The store sets version to 1 on success. If a record already exists, the store throws `ConcurrencyConflictError`.
- `load()` returns `null` for workflows that don't exist.
- There is no `delete()` or `list()` method. These are application-level concerns, not engine concerns.

The `save()` method uses an options object (rather than positional parameters) so the worker can extend it with additional fields (e.g., `outbox`) without a breaking change:

```ts
// Future: @rytejs/worker extends SaveOptions
interface WorkerSaveOptions extends SaveOptions {
	outbox?: OutboxCommand[];
}
```

#### Error types

```ts
class ConcurrencyConflictError extends Error {
	readonly workflowId: string;
	readonly expectedVersion: number;
	readonly actualVersion: number;
}

class WorkflowAlreadyExistsError extends Error {
	readonly workflowId: string;
}

class WorkflowNotFoundError extends Error {
	readonly workflowId: string;
}

class RouterNotFoundError extends Error {
	readonly routerName: string;
}

class RestoreError extends Error {
	readonly workflowId: string;
	readonly validationError: ValidationError; // from core
}
```

The engine uses exceptions (not the result pattern) for infrastructure errors. Rationale: core's result pattern (`{ ok, error }`) is for domain-level dispatch outcomes. Infrastructure errors (store down, version conflict, workflow not found) are a different category — they represent failures in the IO layer, not in the domain logic. The engine's `execute()` returns `DispatchResult` for domain outcomes and throws for infrastructure failures. This distinction maps cleanly to HTTP: domain errors become 422, infrastructure errors become 4xx/5xx.

#### ExecutionEngine

```ts
interface EngineOptions {
	store: StoreAdapter;
	routers: Record<string, WorkflowRouter<WorkflowConfig>>;
	lockTimeout?: number; // default: 30_000 (30 seconds)
}

interface ExecutionResult {
	result: DispatchResult<WorkflowConfig>;
	events: EmittedEvent[];
	version: number;
}
```

`ExecutionResult` is not generic over `TConfig`. The engine holds a heterogeneous router map, so it cannot know the specific config at call time. The `result` field is typed as `DispatchResult<WorkflowConfig>` (the base). Callers who need typed results should narrow manually or use the router directly with their own load-dispatch-save cycle.

```ts
function createEngine(options: EngineOptions): ExecutionEngine;

class ExecutionEngine {
	constructor(options: EngineOptions);

	create(
		routerName: string,
		id: string,
		init: { initialState: string; data: unknown },
	): Promise<{ workflow: WorkflowSnapshot; version: number }>;

	execute(
		routerName: string,
		id: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult>;

	load(id: string): Promise<StoredWorkflow | null>;

	getRouter(name: string): WorkflowRouter<WorkflowConfig>;
}
```

Both `createEngine(options)` and `new ExecutionEngine(options)` are supported. The factory function is the recommended API.

`getRouter()` returns the router for the given name or throws `RouterNotFoundError`. Used by callers who need the router reference for reactor resolution.

`load()` does not take a `routerName` — it only needs the workflow ID to fetch from the store. The store is ID-addressed.

The `execute()` method performs the full cycle:

```
acquire in-process lock on workflowId (with lockTimeout)
  → store.load(id)
    → if null: throw WorkflowNotFoundError
  → find router by routerName
    → if not found: throw RouterNotFoundError
  → definition.restore(snapshot)
    → if restore fails: throw RestoreError
  → router.dispatch(workflow, command)
  → definition.snapshot(result.workflow)
  → store.save({ id, snapshot, events, expectedVersion: stored.version })
    → if version conflict: throw ConcurrencyConflictError
  → release lock
  → return { result: dispatchResult, events, version }
```

When dispatch returns `{ ok: false }` (domain/validation/router error), the engine does NOT save — it returns the result as-is. Only successful dispatches trigger persistence. The version in the result reflects the stored version (unchanged for failed dispatches, incremented for successful ones).

The `create()` method:

```
acquire in-process lock on workflowId (with lockTimeout)
  → store.load(id)
    → if not null: throw WorkflowAlreadyExistsError
  → find router by routerName
  → definition.createWorkflow(id, init) — wrapped in try/catch (createWorkflow throws on invalid data)
  → definition.snapshot(workflow)
  → store.save({ id, snapshot, events: [], expectedVersion: 0 })
    → if ConcurrencyConflictError (race condition): catch and re-throw as WorkflowAlreadyExistsError
  → release lock
  → return { workflow: snapshot, version: 1 }
```

The pre-check `load()` provides a fast path with a clear error message. The `expectedVersion: 0` check in `save()` is the actual safety net for multi-process races — if another process creates the same workflow between load and save, the store rejects the write. The engine catches the `ConcurrencyConflictError` and re-throws as `WorkflowAlreadyExistsError` for a consistent caller experience.

#### In-process locking

A `Map<string, Promise<void>>` serializes operations on the same workflow ID within a single process. Implementation: chain promises so concurrent calls queue behind the in-flight operation.

```ts
const locks = new Map<string, Promise<void>>();

async function withLock<T>(id: string, fn: () => Promise<T>, timeout: number): Promise<T> {
	const prev = locks.get(id) ?? Promise.resolve();
	let resolve: () => void;
	const gate = new Promise<void>((r) => { resolve = r; });
	locks.set(id, gate);

	// Wait for previous operation to complete
	await Promise.race([
		prev,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Lock timeout for ${id}`)), timeout)
		),
	]);

	try {
		return await fn();
	} finally {
		resolve!();
		// Cleanup: only delete if we are still the tail
		if (locks.get(id) === gate) locks.delete(id);
	}
}
```

This prevents concurrent dispatches to the same workflow within one process. For multi-process deployments, the store's optimistic concurrency (`expectedVersion` check) catches conflicts. The engine does not provide distributed locking — that is infrastructure-level and can be layered on top.

#### In-memory store

An in-memory `StoreAdapter` implementation for testing and prototyping. Exported from `@rytejs/core/engine`.

```ts
function memoryStore(): StoreAdapter;
```

Uses a `Map<string, StoredWorkflow>` internally. Supports version checking. Not durable — data is lost when the process exits. NOT for production.

#### Event handling

Events are **returned in `ExecutionResult.events`** and **persisted atomically with the snapshot** via `store.save()`. The engine does not publish events to external systems, does not provide an event bus, and does not execute reactors.

This follows core's IO/Domain/IO pattern: the engine owns the persistence IO, the caller owns event processing IO. The caller iterates `result.events` and publishes to Kafka, sends emails, enqueues reactor commands, or does nothing.

Rationale: event distribution and event persistence have fundamentally different failure modes, retry semantics, and scaling characteristics. The engine handles the latter; the former is an infrastructure concern.

#### Package exports

```ts
// @rytejs/core/engine
export { createEngine, ExecutionEngine } from "./engine.js";
export {
	ConcurrencyConflictError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
	RouterNotFoundError,
	RestoreError,
} from "./errors.js";
export { memoryStore } from "./memory-store.js";
export type {
	EngineOptions,
	ExecutionResult,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
	EmittedEvent,
} from "./types.js";
```

### `@rytejs/core/http`

A thin adapter that binds the engine to the Fetch API. One function in, one function out.

#### API

```ts
interface HttpHandlerOptions {
	engine: ExecutionEngine;
	basePath?: string; // default: "/"
}

function createHandler(options: HttpHandlerOptions): (request: Request) => Promise<Response>;
```

The returned function is a standard `(Request) => Promise<Response>` — the universal interface for Cloudflare Workers, Bun, Deno, Node 18+, Hono, and Express (with adapter).

#### URL convention

The handler resolves the router name and workflow ID from the URL path:

```
PUT  /:name/:id   →  engine.create()    →  201 Created | 400 | 409 | 500
POST /:name/:id   →  engine.execute()   →  200 OK | 400 | 404 | 409 | 422 | 500 | 503
GET  /:name/:id   →  engine.load()      →  200 OK | 404 | 500
```

The `:name` segment matches the keys in `EngineOptions.routers`. The mapping is explicit: `routers: { orders: orderRouter }` means `PUT /orders/order-123`. No implicit naming from definition names.

The handler validates `Content-Type: application/json` on PUT and POST requests. Missing or incorrect content type returns 400.

PUT and POST request bodies are validated: PUT requires `{ initialState: string, data: unknown }`, POST requires `{ type: string, payload: unknown }`. Missing or malformed fields return 400.

#### Error mapping

The HTTP layer maps engine errors and dispatch results to HTTP status codes. All five `PipelineError` categories from core are covered:

| Source | HTTP Status | When |
|---|---|---|
| Successful dispatch | 200 | `result.ok === true` |
| Successful create | 201 | Workflow created |
| `category: "domain"` | 422 Unprocessable Entity | Business rule rejection |
| `category: "validation"` | 400 Bad Request | Invalid command payload (Zod) |
| `category: "router"` | 400 Bad Request | Unknown command type for current state |
| `category: "dependency"` | 503 Service Unavailable | Handler dependency failure |
| `category: "unexpected"` | 500 Internal Server Error | Unhandled error in handler |
| `WorkflowNotFoundError` | 404 Not Found | Workflow ID not in store |
| `RouterNotFoundError` | 404 Not Found | Router name not in engine |
| `ConcurrencyConflictError` | 409 Conflict | Optimistic concurrency violation |
| `WorkflowAlreadyExistsError` | 409 Conflict | PUT for existing workflow ID |
| `RestoreError` | 500 Internal Server Error | Snapshot restore failed |
| Malformed request body | 400 Bad Request | JSON parse error or missing fields |
| Invalid Content-Type | 400 Bad Request | Not application/json on PUT/POST |
| Unsupported HTTP method | 405 Method Not Allowed | DELETE, PATCH, etc. |

#### Response format

All responses use a consistent envelope. Successful dispatches return the `DispatchResult` structure directly. All errors (both dispatch errors and infrastructure errors) use the same shape:

```jsonc
// PUT /:name/:id — 201
{ "ok": true, "workflow": { "id": "order-123", "state": "Draft", "data": { ... } }, "version": 1 }

// POST /:name/:id — 200 (successful dispatch)
{ "ok": true, "workflow": { "state": "Placed", "data": { ... } }, "events": [...], "version": 2 }

// POST /:name/:id — 422 (domain error)
{ "ok": false, "error": { "category": "domain", "code": "EmptyCart", "data": { ... } } }

// POST /:name/:id — 400 (validation error)
{ "ok": false, "error": { "category": "validation", "message": "..." } }

// POST /:name/:id — 400 (router error — unknown command)
{ "ok": false, "error": { "category": "router", "message": "..." } }

// Any — 404 (not found)
{ "ok": false, "error": { "category": "not_found", "message": "..." } }

// Any — 409 (conflict)
{ "ok": false, "error": { "category": "conflict", "message": "..." } }

// Any — 503 (dependency failure)
{ "ok": false, "error": { "category": "dependency", "message": "..." } }

// Any — 500 (unexpected)
{ "ok": false, "error": { "category": "unexpected", "message": "..." } }
```

All responses use `{ ok: boolean }` as the discriminant, consistent with core's result pattern at the HTTP boundary.

#### Mounting

```ts
// Bun
Bun.serve({ fetch: handler });

// Deno
Deno.serve(handler);

// Cloudflare Workers
export default { fetch: handler };

// Hono (under a prefix)
app.mount("/workflows", handler);

// Express (with adapter)
import { toExpress } from "@rytejs/core/http";
app.use("/workflows", toExpress(handler));
```

The `basePath` option handles prefix stripping when the handler is mounted at a sub-path. When set to `/workflows`, a request to `/workflows/orders/order-123` resolves `orders` as the router name and `order-123` as the workflow ID.

#### What it does NOT do

- Does not start a server — that's the user's `Bun.serve()` or `Deno.serve()` call.
- Does not handle authentication, CORS, or rate limiting — use your framework's middleware.
- Does not publish events to external systems.
- Does not execute reactors.
- Does not provide a typed HTTP client (future concern).
- Does not handle OPTIONS or HEAD — defer to the outer framework.

#### Package exports

```ts
// @rytejs/core/http
export { createHandler } from "./handler.js";
export { toExpress } from "./adapters/express.js";
export type { HttpHandlerOptions } from "./types.js";
```

### `@rytejs/core/reactor`

Type-safe, pure mapping from workflow events to command descriptors. No execution, no IO, no side effects.

#### API

```ts
interface ReactorCommand {
	workflowId: string;
	routerName: string;
	command: { type: string; payload: unknown };
}

interface ReactorContext<TConfig extends WorkflowConfig, TEvent extends EventNames<TConfig>> {
	event: { type: TEvent; data: EventData<TConfig, TEvent> };
	workflowId: string;
}
```

```ts
class Reactors {
	on<TConfig extends WorkflowConfig, TEvent extends EventNames<TConfig>>(
		router: WorkflowRouter<TConfig>,
		event: TEvent,
		handler: (ctx: ReactorContext<TConfig, TEvent>) => ReactorCommand | ReactorCommand[] | null,
	): this;

	resolve<TConfig extends WorkflowConfig>(
		router: WorkflowRouter<TConfig>,
		workflowId: string,
		events: EmittedEvent[],
	): ReactorCommand[];
}

function createReactors(): Reactors;
```

Type safety:
- The `event` parameter in `on()` autocompletes from the source router's config.
- `ctx.event.data` is typed from the event's Zod schema via the `_resolved` phantom type.
- The handler returns `ReactorCommand` — currently untyped on the target side. Full target-router type inference (constraining `command.type` and `command.payload` from the target router) is a v2 enhancement that requires a more complex generic signature.

Internal type narrowing: `resolve()` receives `EmittedEvent[]` where `data` is `unknown`. Internally, it matches `event.type` against registered handlers and passes the event to the matching handler. The handler receives `data` typed as `EventData<TConfig, TEvent>`. This cast from `unknown` is safe because core's `emit()` validates event data against the Zod schema before emitting — the type string is the discriminant, and the data shape is guaranteed.

#### Usage

```ts
const reactors = createReactors();

reactors.on(orderRouter, "OrderPlaced", ({ event, workflowId }) => ({
	workflowId: event.data.shipmentId,
	routerName: "shipments",
	command: { type: "Prepare", payload: { orderId: workflowId } },
}));

// After a dispatch:
const commands = reactors.resolve(orderRouter, "order-123", result.events);
// → [{ workflowId: "ship-456", routerName: "shipments", command: { type: "Prepare", ... } }]
```

#### Execution is the caller's concern

The reactor produces command descriptors. What happens with them depends on the caller:

- **HTTP handler (manual):** iterate commands, call `engine.execute()` for each.
- **Queue worker:** write commands to an outbox, drain to queue.
- **Test harness:** assert on the returned commands without executing.

The reactor does not know about the engine, the store, HTTP, or queues. It is a pure function: events in, command descriptors out.

#### FIFO execution pattern

When the caller executes reactor commands, and those commands produce events that trigger more reactor commands, the recommended execution pattern is a FIFO queue:

```ts
const queue: ReactorCommand[] = [];
queue.push(...reactors.resolve(router, workflowId, result.events));

let processed = 0;
const maxCommands = 100;

while (queue.length > 0) {
	if (processed++ >= maxCommands) throw new Error("Reactor cascade limit exceeded");
	const cmd = queue.shift()!;
	const targetRouter = engine.getRouter(cmd.routerName);
	const r = await engine.execute(cmd.routerName, cmd.workflowId, cmd.command);
	if (r.result.ok) {
		queue.push(...reactors.resolve(targetRouter, cmd.workflowId, r.events));
	}
}
```

Each command saves independently (per-command transactions, not all-or-nothing). This matches the actor model: each workflow commits its own state change. A failed reactor command does not roll back the original dispatch.

This pattern is NOT built into the reactor package. It is documented as the recommended approach and will be implemented by `@rytejs/worker`.

#### Package exports

```ts
// @rytejs/core/reactor
export { createReactors, Reactors } from "./reactors.js";
export type { ReactorCommand, ReactorContext } from "./types.js";
```

## Full wiring example

```ts
import { createEngine } from "@rytejs/core/engine";
import { createHandler } from "@rytejs/core/http";
import { postgresStore } from "@rytejs/store-postgres";
import { orderRouter } from "./workflows/order.js";
import { shipmentRouter } from "./workflows/shipment.js";

const engine = createEngine({
	store: postgresStore({ connectionString: process.env.DATABASE_URL }),
	routers: { orders: orderRouter, shipments: shipmentRouter },
});

const handler = createHandler({ engine });

Bun.serve({ fetch: handler, port: 3000 });
```

That is a complete workflow server: HTTP in, dispatch, persist, respond. 10 lines.

For reactor wiring (manual, until `@rytejs/worker` ships):

```ts
import { createReactors } from "@rytejs/core/reactor";

const reactors = createReactors()
	.on(orderRouter, "OrderPlaced", ({ event, workflowId }) => ({
		workflowId: event.data.shipmentId,
		routerName: "shipments",
		command: { type: "Prepare", payload: { orderId: workflowId } },
	}));

// In the application layer, after a dispatch:
const result = await engine.execute("orders", "order-123", command);
if (result.result.ok) {
	const commands = reactors.resolve(orderRouter, "order-123", result.events);
	for (const cmd of commands) {
		await engine.execute(cmd.routerName, cmd.workflowId, cmd.command);
	}
}
```

## Package structure

All three modules live inside `packages/core/`:

```
packages/core/
├── src/
│   ├── index.ts              ← existing root exports (unchanged)
│   ├── engine/
│   │   ├── index.ts          ← createEngine, StoreAdapter, errors, memoryStore
│   │   ├── engine.ts
│   │   ├── lock.ts
│   │   ├── memory-store.ts
│   │   ├── errors.ts
│   │   └── types.ts
│   ├── reactor/
│   │   ├── index.ts          ← createReactors, Reactors
│   │   ├── reactors.ts
│   │   └── types.ts
│   └── http/
│       ├── index.ts          ← createHandler, toExpress
│       ├── handler.ts
│       ├── adapters/
│       │   └── express.ts
│       └── types.ts
```

Added to `packages/core/package.json`:

```jsonc
{
	"exports": {
		".": "./dist/index.js",
		"./engine": "./dist/engine/index.js",
		"./reactor": "./dist/reactor/index.js",
		"./http": "./dist/http/index.js"
	}
}
```

The root export (`.`) remains unchanged. Existing consumers are unaffected.

## Dependency graph

```
@rytejs/core                  ← pure engine + subpath exports (peer: zod)
  core/engine                 ← imports from core root (types, definition, router)
  core/reactor                ← imports from core root (types only)
  core/http                   ← imports from core/engine

@rytejs/worker                ← queue-based runtime (peer: core — uses core/engine + core/reactor)
@rytejs/store-postgres        ← Postgres store (peer: core — implements core/engine's StoreAdapter)
@rytejs/otel                  ← OpenTelemetry plugin (peer: core — hooks into core's plugin system)
@rytejs/testing               ← test utilities (peer: core)
```

## Relationship to @rytejs/worker

`@rytejs/worker` (designed in the existing worker spec) becomes a consumer of `core/engine` and `core/reactor`. It adds:

- Queue polling (`QueueAdapter` interface)
- Retry policies with per-category configuration
- Dead-lettering
- Transactional outbox (reactor commands persisted alongside snapshots)
- Automatic reactor execution (the FIFO drain loop)
- Graceful shutdown
- Worker lifecycle hooks

The worker imports `ExecutionEngine` and `Reactors` from core's subpath exports. It does NOT duplicate the load-dispatch-save cycle or the reactor resolution logic.

The worker extends the engine's `StoreAdapter` via `SaveOptions`:

```ts
// @rytejs/worker extends SaveOptions for outbox support
interface WorkerSaveOptions extends SaveOptions {
	outbox?: OutboxCommand[];
}

interface WorkerStoreAdapter extends StoreAdapter {
	save(options: WorkerSaveOptions): Promise<void>;
	drainOutbox(): Promise<OutboxCommand[]>;
	markPublished(ids: string[]): Promise<void>;
}
```

This is possible because `save()` uses an options object, so extending it with additional fields is a compatible change. A `WorkerStoreAdapter` implementation also satisfies the base `StoreAdapter` interface.

The worker spec's reactor API uses router references (`router: shipmentRouter`), while `core/reactor`'s `ReactorCommand` uses string names (`routerName: "shipments"`). The worker resolves this by looking up the router name from `router.definition.name` when constructing `ReactorCommand` objects. The `ReactorCommand` type uses strings because command descriptors may be serialized (outbox, queue messages) where object references are not available.

## Scope

### In scope

- `createEngine()` factory and `ExecutionEngine` class with `create()`, `execute()`, `load()`, `getRouter()`
- `StoreAdapter` interface with `load()`, `save(options)`
- `SaveOptions` as extensible options object for `save()`
- `ConcurrencyConflictError`, `WorkflowAlreadyExistsError`, `WorkflowNotFoundError`, `RouterNotFoundError`, `RestoreError`
- In-process per-workflow-ID locking with configurable timeout
- `memoryStore()` for testing/prototyping
- `createHandler()` returning `(Request) => Promise<Response>`
- URL convention: PUT (create), POST (dispatch), GET (read)
- HTTP error mapping for all five `PipelineError` categories plus infrastructure errors
- Consistent `{ ok: boolean }` response envelope
- `toExpress()` adapter for Express compatibility
- `createReactors()` with `.on()` and `.resolve()`
- Core prerequisite: public `WorkflowRouter.definition`

### Out of scope

- Concrete store implementations (separate packages: `@rytejs/store-postgres`, etc.)
- Queue-based worker (`@rytejs/worker` — separate package)
- Outbox pattern (worker concern)
- Event publishing to external systems (caller's responsibility)
- Reactor execution (caller's responsibility; worker automates this later)
- Typed HTTP client
- React / frontend adapter
- Authentication, CORS, rate limiting (use your framework)
- Workflow listing or deletion (application-level concerns)
- Distributed locking (infrastructure concern)
- Target-router type inference for reactor commands (v2 enhancement)
