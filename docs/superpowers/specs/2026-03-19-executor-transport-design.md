# Executor & Transport Design

## Problem

Ryte workflows are pure — state in, state out. But to use them in production you need persistence, concurrent write safety, and real-time updates to connected clients. The old `ExecutionEngine` class hardcoded a lock → load → dispatch → save flow with no extensibility. We need a minimal abstraction that provides Durable Object-like functionality (versioned writes, snapshot + event broadcast) and wires cleanly into any runtime (Cloudflare Workers, Node, Deno, Bun).

## Architecture

```
Workflow (pure)           Executor (IO)                Client (IO)
──────────────────        ─────────────────────        ─────────────────
definition                WorkflowExecutor             Transport
router.dispatch()         ├─ withStore(store)          ├─ wsTransport
  state in → state out    ├─ withBroadcast(subs)       ├─ sseTransport
  no side effects         └─ custom middleware         └─ pollingTransport
```

The boundary is Clean Architecture: workflows are the functional core (pure domain), the executor is the imperative shell (IO). Handlers are pure — IO happens before and after dispatch. The executor is the thing that does the before and after.

## Executor

### What it is

A middleware pipeline that wraps `router.dispatch()` with infrastructure concerns. Mirrors the `WorkflowRouter` pattern — constructor takes the core thing, `use()` adds capabilities.

### API

```typescript
const executor = new WorkflowExecutor(orderRouter);
executor.use(withStore(memoryStore()));
executor.use(withBroadcast(subscribers));

// Create a workflow — runs through middleware pipeline
const created = await executor.create("order-123", {
	initialState: "Draft",
	data: { items: [] },
});

// Execute a command — runs through middleware pipeline
const result = await executor.execute("order-123", {
	type: "PlaceOrder",
	payload: { items: [{ sku: "A", qty: 1 }] },
});
```

Each executor is bound to one router. Multi-router setups use multiple executors:

```typescript
const orders = new WorkflowExecutor(orderRouter);
const invoices = new WorkflowExecutor(invoiceRouter);
orders.use(withStore(store));
invoices.use(withStore(store));
```

### `WorkflowExecutor` class

```typescript
class WorkflowExecutor<TConfig extends WorkflowConfig> {
	constructor(router: WorkflowRouter<TConfig>);

	use(middleware: ExecutorMiddleware): this;
	use(plugin: ExecutorPlugin): this;

	on(event: "execute:start", callback: (ctx: ExecutorContext) => void | Promise<void>): this;
	on(event: "execute:end", callback: (ctx: ExecutorContext) => void | Promise<void>): this;

	execute(
		id: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult>;

	create(
		id: string,
		init: { initialState: string; data: unknown },
	): Promise<ExecutionResult>;
}
```

### Error handling

**`execute()` and `create()` never throw** — same guarantee as `router.dispatch()`. The executor wraps the entire middleware pipeline in a catch boundary:

```typescript
async execute(id, command) {
	const ctx = createExecuteContext(id, command);

	await this.hooks.emit("execute:start", ctx);
	try {
		await compose([...this.middleware, this.coreHandler])(ctx);
	} catch (err) {
		// Anything that escaped middleware → unexpected error
		ctx.result = { ok: false, error: { category: "unexpected", error: err } };
		ctx.snapshot = null;
	}
	await this.hooks.emit("execute:end", ctx); // guaranteed if start fired

	return this.toExecutionResult(ctx);
}
```

Three layers of error handling:

| Error type | Where handled | How |
|---|---|---|
| Expected domain errors | Router (inner) | Result pattern — `router.dispatch()` returns `{ ok: false }` |
| Expected IO errors | Middleware (middle) | Set `ctx.result`, return early — no throw |
| Unexpected errors | Executor boundary (outer) | try/catch → `{ category: "unexpected" }` |

### Core handler

The core handler is appended as the terminal middleware (innermost function in the onion). Its behavior depends on `ctx.operation`:

- **execute**: calls `definition.restore()` on `ctx.stored.snapshot` to rehydrate from JSON, calls `router.dispatch()`, sets `ctx.result`, `ctx.snapshot` (via `definition.snapshot()`), and `ctx.events`
- **create**: calls `definition.createWorkflow()`, sets `ctx.snapshot` (via `definition.snapshot()`). If `createWorkflow` throws (invalid state name or data fails Zod validation), the error is caught and mapped to `{ category: "validation" }` on `ctx.result`. No events are emitted for creates.

### ExecutionResult

```typescript
type ExecutionResult =
	| {
		ok: true;
		snapshot: WorkflowSnapshot;
		version: number;
		events: Array<{ type: string; data: unknown }>;
	}
	| {
		ok: false;
		error: PipelineError | ExecutorError;
	};

type ExecutorError =
	| { category: "not_found"; id: string }
	| { category: "conflict"; id: string; expectedVersion: number; actualVersion: number }
	| { category: "already_exists"; id: string }
	| { category: "restore"; id: string; issues: unknown[] }
	| { category: "unexpected"; error: unknown };
```

Error flow: the core handler calls `router.dispatch()` which returns `DispatchResult`. If `result.ok` is false, the core handler maps `result.error` (a `PipelineError` with categories `validation`, `domain`, `router`, `unexpected`, `dependency`) onto `ctx.result` and does not set `ctx.snapshot`. The executor reads `ctx.result` and surfaces the `PipelineError` in `ExecutionResult`. This means all five `PipelineError` categories flow through to consumers via the `ExecutionResult.error` union, discriminated by `category` as usual.

### ExecutorContext

Uses a discriminated union on `operation` — consistent with how `DispatchResult` discriminates on `ok` and `PipelineError` discriminates on `category`.

```typescript
type ExecutorContext = ExecuteContext | CreateContext;

interface ExecutorContextBase {
	readonly id: string;
	readonly expectedVersion?: number; // optional — set by transport handlers for early conflict detection

	// Mutable — populated by middleware
	stored: StoredWorkflow | null;
	result: DispatchResult | null;
	snapshot: WorkflowSnapshot | null;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

interface ExecuteContext extends ExecutorContextBase {
	readonly operation: "execute";
	readonly command: { type: string; payload: unknown };
}

interface CreateContext extends ExecutorContextBase {
	readonly operation: "create";
	readonly init: { initialState: string; data: unknown };
}
```

Middleware that only cares about common fields (id, snapshot, version) uses `ExecutorContext`. Middleware that needs to branch can narrow via `ctx.operation`.

### ExecutorMiddleware

```typescript
type ExecutorMiddleware = (
	ctx: ExecutorContext,
	next: () => Promise<void>,
) => Promise<void>;
```

Same signature as router middleware — Koa-style onion model, reuses the existing `compose()` function.

### Hooks

Two lifecycle hooks, mirroring `dispatch:start` / `dispatch:end` on the router:

| Hook | When | Guarantee |
|---|---|---|
| `execute:start` | Before middleware pipeline runs | Always fires |
| `execute:end` | After pipeline completes or errors | Fires if `execute:start` fired |

Both receive `ExecutorContext`. `ctx.operation` tells you whether it's a create or execute. Hooks are observers — they cannot modify the flow. Errors in hooks are caught and forwarded to `onHookError` (same as router hooks).

### Plugins

```typescript
type ExecutorPlugin = ((executor: WorkflowExecutor<any>) => void) & { readonly [PLUGIN_SYMBOL]: true };

function defineExecutorPlugin(
	fn: (executor: WorkflowExecutor<any>) => void,
): ExecutorPlugin;
```

Same branded function pattern as router plugins. A plugin receives the executor and can call `use()` and `on()`:

```typescript
const otelExecutorPlugin = defineExecutorPlugin((executor) => {
	executor.on("execute:start", (ctx) => { /* start span */ });
	executor.on("execute:end", (ctx) => { /* end span */ });
	executor.use(async (ctx, next) => {
		await otelContext.with(activeSpan, next);
	});
});

executor.use(otelExecutorPlugin);
```

The executor and router otel plugins are independent — they don't know about each other. The parent-child span relationship works through OTel context propagation: the router dispatch happens within the executor's active span.

## Built-in Middleware

### `withStore(store: StoreAdapter)`

Handles persistence. Before `next()`: loads the stored workflow (for execute) or validates non-existence (for create). After `next()`: saves the new snapshot with version check and outbox events.

```typescript
function withStore(store: StoreAdapter): ExecutorMiddleware {
	return async (ctx, next) => {
		if (ctx.operation === "execute") {
			const stored = await store.load(ctx.id);
			if (!stored) {
				ctx.result = { ok: false, error: { category: "not_found", id: ctx.id } };
				return; // don't call next()
			}
			ctx.stored = stored;

			// Early conflict detection — if transport provided expectedVersion
			if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== stored.version) {
				ctx.result = {
					ok: false,
					error: {
						category: "conflict",
						id: ctx.id,
						expectedVersion: ctx.expectedVersion,
						actualVersion: stored.version,
					},
				};
				return;
			}
		} else {
			// Early check — the real uniqueness guarantee is expectedVersion: 0 on save.
			// This load is just for a better error message on the common case.
			const existing = await store.load(ctx.id);
			if (existing) {
				ctx.result = { ok: false, error: { category: "already_exists", id: ctx.id } };
				return;
			}
		}

		await next();

		// Guard: only save if the core handler produced a snapshot.
		// Skips save if dispatch failed or create threw (snapshot stays null).
		if (ctx.snapshot) {
			try {
				await store.save({
					id: ctx.id,
					snapshot: ctx.snapshot,
					expectedVersion: ctx.stored?.version ?? 0,
					events: ctx.events,
				});
				ctx.version = (ctx.stored?.version ?? 0) + 1;
			} catch (err) {
				// ConcurrencyConflictError from store → set result, don't throw
				if (err instanceof ConcurrencyConflictError) {
					ctx.result = {
						ok: false,
						error: {
							category: "conflict",
							id: ctx.id,
							expectedVersion: ctx.stored?.version ?? 0,
							actualVersion: -1, // unknown — another writer won
						},
					};
					ctx.snapshot = null;
					return;
				}
				throw err; // truly unexpected → hits executor boundary
			}
		}
	};
}
```

### `withBroadcast(subscribers: SubscriberRegistry)`

Pushes updates to all connected clients after successful execution.

```typescript
function withBroadcast(subscribers: SubscriberRegistry): ExecutorMiddleware {
	return async (ctx, next) => {
		await next();

		// Guard on ctx.snapshot — reliable signal that execution succeeded
		// and save happened (if withStore is present).
		if (ctx.snapshot) {
			subscribers.notify(ctx.id, {
				snapshot: ctx.snapshot,
				version: ctx.version,
				events: ctx.events,
			});
		}
	};
}
```

**Middleware ordering:** `withStore` must come before `withBroadcast` in the `use()` calls so that `ctx.version` is populated before broadcast fires. This ordering is documented and intuitive — you store before you broadcast.

### SubscriberRegistry

```typescript
interface SubscriberRegistry {
	subscribe(id: string, callback: (message: BroadcastMessage) => void): () => void;
	notify(id: string, message: BroadcastMessage): void;
}

function createSubscriberRegistry(): SubscriberRegistry;
```

In-memory map of workflow ID → set of callbacks. Transport server-side handlers add/remove subscribers.

`BroadcastMessage` is a single shared type used by both the subscriber registry and the transport interface — defined once in `core/src/executor/types.ts` and re-exported from the transport types module.

## Store Adapter Changes

### SaveOptions — outbox events

```typescript
interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
	events?: Array<{ type: string; data: unknown }>; // outbox — saved atomically with snapshot
}
```

The `events` field is optional — backward-compatible with existing store implementations. The built-in `memoryStore()` will be updated to accept and ignore the events field.

A Postgres store saves both in one transaction. A memory store ignores the events. A separate process polls the outbox for durable event processing — that is a user concern, not a core concern.

### Outbox Pattern Example

The outbox pattern ensures events are persisted atomically with the snapshot, then consumed reliably by a separate process. Here is a complete example using a transactional store:

```typescript
// A store adapter that implements the outbox pattern
function postgresOutboxStore(pool: Pool): StoreAdapter {
	return {
		async load(id) {
			const row = await pool.query(
				"SELECT snapshot, version FROM workflows WHERE id = $1",
				[id],
			);
			if (!row) return null;
			return { snapshot: row.snapshot, version: row.version };
		},

		async save({ id, snapshot, expectedVersion, events }) {
			// Single transaction: save snapshot + persist events in outbox table
			await pool.transaction(async (tx) => {
				const result = await tx.query(
					`UPDATE workflows SET snapshot = $1, version = version + 1
					 WHERE id = $2 AND version = $3
					 RETURNING version`,
					[snapshot, id, expectedVersion],
				);
				if (result.rowCount === 0) {
					// INSERT for new workflows, or conflict for version mismatch
					const existing = await tx.query(
						"SELECT version FROM workflows WHERE id = $1",
						[id],
					);
					if (existing) throw new ConcurrencyConflictError(id);
					await tx.query(
						"INSERT INTO workflows (id, snapshot, version) VALUES ($1, $2, 1)",
						[id, snapshot],
					);
				}

				// Outbox: persist events in the same transaction
				if (events && events.length > 0) {
					for (const event of events) {
						await tx.query(
							`INSERT INTO outbox (workflow_id, event_type, event_data, created_at)
							 VALUES ($1, $2, $3, NOW())`,
							[id, event.type, JSON.stringify(event.data)],
						);
					}
				}
			});
		},
	};
}

// Usage — the executor doesn't know or care about the outbox
const executor = new WorkflowExecutor(orderRouter);
executor.use(withStore(postgresOutboxStore(pool)));
executor.use(withBroadcast(subscribers));

// A separate process polls the outbox and processes events
async function processOutbox(pool: Pool) {
	const rows = await pool.query(
		"SELECT id, workflow_id, event_type, event_data FROM outbox ORDER BY created_at LIMIT 100",
	);
	for (const row of rows) {
		await handleEvent(row.workflow_id, { type: row.event_type, data: row.event_data });
		await pool.query("DELETE FROM outbox WHERE id = $1", [row.id]);
	}
}
```

The key: `store.save()` persists the snapshot and events atomically. If the transaction fails, neither is written. The outbox processor is a separate concern — it reads from the outbox table and publishes events to Kafka, sends emails, triggers reactors, etc. The executor and `withStore` middleware know nothing about the outbox — it's entirely encapsulated in the store adapter.

### StoredWorkflow and StoreAdapter

`StoredWorkflow` and `StoreAdapter` interfaces are unchanged. The `SaveOptions.events` extension is backward-compatible — existing store implementations continue to work without modification.

```typescript
interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}
```

## Transport Interface (Client-Side)

### What it is

The contract between a client (React store) and a server (executor + subscriber registry). Two methods: dispatch commands, subscribe to updates.

### Interface

```typescript
interface Transport {
	dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult>;

	subscribe(
		id: string,
		callback: (message: BroadcastMessage) => void,
	): TransportSubscription;
}

type TransportResult =
	| {
		ok: true;
		snapshot: WorkflowSnapshot;
		version: number;
		events: Array<{ type: string; data: unknown }>;
	}
	| {
		ok: false;
		error: TransportError | PipelineError;
	};

interface TransportError {
	category: "transport";
	code: "NETWORK" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT";
	message: string;
}

interface BroadcastMessage {
	snapshot: WorkflowSnapshot;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

interface TransportSubscription {
	unsubscribe(): void;
}
```

### Three Implementations

All use standard Web APIs (`fetch`, `WebSocket`, `EventSource`) — no Node-specific dependencies. Work in Cloudflare Workers, Node, Deno, Bun, and browsers.

#### `wsTransport(url)`

Full-duplex WebSocket connection. Dispatches commands and receives broadcasts over the same connection.

- `dispatch()` sends JSON message, awaits response message
- `subscribe()` registers callback for incoming broadcast messages
- Reconnection with backoff on disconnect

#### `sseTransport(url)`

Server-Sent Events for server → client broadcast. HTTP POST for client → server dispatch.

- `dispatch()` calls `fetch(url, { method: "POST", body })`
- `subscribe()` opens `EventSource(url)` for incoming updates
- Auto-reconnect is built into EventSource

#### `pollingTransport(url, interval?)`

Long polling fallback for environments without WebSocket or SSE support.

- `dispatch()` calls `fetch(url, { method: "POST", body })`
- `subscribe()` polls `fetch(url)` on interval, compares version to detect changes
- Default interval: 5 seconds

### Client `expectedVersion` Flow

The client sends `expectedVersion` with every dispatch. The `withStore` middleware checks this: if `expectedVersion` is set on `ExecutorContextBase` and doesn't match `stored.version`, it returns a `conflict` error immediately without calling `next()`. The server-side transport handler sets `ctx.expectedVersion` from the client's request.

If `expectedVersion` is not set (e.g., called directly without a transport), `withStore` skips the check — the optimistic version on `save()` is still the safety net.

### Server-Side Transport Helpers

Functions using standard Web APIs (`Request`/`Response`). **Note on WebSocket upgrades:** the `WebSocket` upgrade mechanism varies across runtimes (Cloudflare uses `WebSocketPair`, Deno uses `Deno.upgradeWebSocket`). The `handleWebSocket` helper targets the Cloudflare/standard `WebSocketPair` API. For other runtimes, users may need a thin adapter over their runtime's upgrade mechanism.

```typescript
function handleWebSocket(
	req: Request,
	subscribers: SubscriberRegistry,
	executor: WorkflowExecutor,
): Response;

function handleSSE(
	req: Request,
	subscribers: SubscriberRegistry,
): Response;

function handlePolling(
	req: Request,
	subscribers: SubscriberRegistry,
): Response;
```

These handle the transport protocol (upgrade, connection management, serialization) and wire into the subscriber registry. The user's HTTP router (Hono, Express, Cloudflare Worker fetch handler) calls them.

## HTTP API

### `createFetch`

Thin fetch handler over executor(s). Maps HTTP methods to executor operations.

```typescript
function createFetch(
	executors: Record<string, WorkflowExecutor>,
	store: StoreAdapter,
): (request: Request) => Promise<Response>;
```

Routes:
- **GET** `/:name/:id` → `store.load(id)` → 200 `{ snapshot, version }`
- **PUT** `/:name/:id` → `executors[name].create(id, body)` → 201 `{ snapshot, version }`
- **POST** `/:name/:id` → `executors[name].execute(id, body)` → 200 `{ snapshot, version, events }`

Note: `createFetch` takes `store` separately for the GET route because loading a workflow is a read — no executor pipeline needed. The store is also used inside `withStore`, so the user passes it twice. This is intentional — `createFetch` does not reach into the executor's internals.

Error mapping:
- `not_found` → 404
- `conflict` → 409
- `already_exists` → 409
- `validation` → 400
- `domain` → 422
- `router` → 400
- `restore` → 500
- `unexpected` → 500
- `dependency` → 503

## React Store Changes

### Optional transport param

```typescript
const store = createWorkflowStore(router, {
	state: "Draft",
	data: { items: [] },
	id: "order-123",
}, {
	transport: wsTransport("wss://api.example.com/sync"),
});
```

When `transport` is provided:
- `store.dispatch()` calls `transport.dispatch()` with the current version as `expectedVersion`
- On success: updates local workflow from returned snapshot
- On `CONFLICT`: surfaces error to UI — client must reload
- Subscribes to `transport.subscribe()` on creation — incoming broadcasts update the local workflow
- `store.cleanup()` calls `subscription.unsubscribe()`

When `transport` is absent: works locally like today, no changes.

## Context Isolation

The executor and router do not share context keys. They are independent layers:

- **Router context** (`Context<TConfig, TDeps>`): command, data, transition, emit, deps, context keys
- **Executor context** (`ExecutorContext`): id, stored, result, snapshot, version, events

A handler cannot access executor-level information (version, stored workflow) and does not need to. If this changes in the future, a read-only context key bridge can be added — but not now.

## What Gets Removed

- `ExecutionEngine` class
- `LockAdapter` interface + `memoryLock()` — version check is sufficient concurrency control
- `QueueAdapter` interface + `memoryQueue()` — events are data in the result, user processes them
- `TransactionalAdapter` interface — outbox pattern via `SaveOptions.events` replaces it
- `createHandler()` — replaced by `createFetch`
- Engine error classes (`LockConflictError`, `WorkflowNotFoundError`, `WorkflowAlreadyExistsError`, `RouterNotFoundError`, `RestoreError`) — replaced by `ExecutorError` discriminated union categories. `ConcurrencyConflictError` is retained (thrown by store adapters, caught by `withStore`).

## What Gets Added

| Item | Location | ~Lines |
|---|---|---|
| `WorkflowExecutor` | `core/src/executor/executor.ts` | 80 |
| `ExecutorContext`, `ExecutorMiddleware`, types | `core/src/executor/types.ts` | 50 |
| `defineExecutorPlugin` | `core/src/executor/plugin.ts` | 15 |
| `withStore` | `core/src/executor/with-store.ts` | 50 |
| `withBroadcast` + `createSubscriberRegistry` | `core/src/executor/with-broadcast.ts` | 40 |
| `Transport` interface + types | `core/src/transport/types.ts` | 30 |
| `wsTransport` | `core/src/transport/ws.ts` | 60 |
| `sseTransport` | `core/src/transport/sse.ts` | 50 |
| `pollingTransport` | `core/src/transport/polling.ts` | 40 |
| Server-side transport helpers | `core/src/transport/server.ts` | 80 |
| `createFetch` | `core/src/http/http.ts` | 60 |
| React store transport integration | `react/src/store.ts` | 40 |
| Executor otel plugin | `otel/src/executor.ts` | 40 |

## What Stays Unchanged

Router, definition, dispatch, middleware, hooks, plugins, snapshots, migrations, context, compose, memory store (for testing/dev), otel router plugin, testing utilities.

## Testing

Tests for the executor and transport layer. Uses `@rytejs/testing` utilities where applicable.

### Executor tests

- `WorkflowExecutor` — create, execute, middleware pipeline ordering, plugin registration
- Error handling — not found, conflict, already exists, restore failure, unexpected errors caught at boundary
- `execute:start` / `execute:end` hooks — fire in correct order, `execute:end` guaranteed on error
- Middleware ordering — store before broadcast, onion model behavior

### withStore tests

- Load before dispatch, save after dispatch
- Version increment on save
- Not found → result, no throw
- Already exists on create → result, no throw
- `ConcurrencyConflictError` → conflict result, no throw
- `expectedVersion` mismatch → early conflict, no dispatch
- Outbox events passed to `store.save()`

### withBroadcast tests

- Notifies subscribers after successful execution
- Does not notify on failed dispatch (snapshot is null)
- Multiple subscribers per workflow ID

### Transport tests

- `wsTransport` — dispatch round-trip, subscribe receives broadcasts, reconnection
- `sseTransport` — dispatch via fetch, subscribe via EventSource
- `pollingTransport` — dispatch via fetch, polling interval detects version changes
- All three: error mapping (NETWORK, CONFLICT, NOT_FOUND, TIMEOUT)

### Integration test

End-to-end: create workflow → dispatch command → verify broadcast received → verify version incremented → concurrent write → verify conflict returned.

### Outbox pattern test

```typescript
describe("outbox pattern", () => {
	test("snapshot and events are saved atomically", async () => {
		const saved: SaveOptions[] = [];
		const outboxStore: StoreAdapter = {
			data: new Map(),
			async load(id) { return this.data.get(id) ?? null; },
			async save(options) {
				saved.push(options);
				// Simulate atomic save — both snapshot and events persist or neither does
				this.data.set(options.id, {
					snapshot: options.snapshot,
					version: (options.expectedVersion) + 1,
				});
			},
		};

		const executor = new WorkflowExecutor(orderRouter);
		executor.use(withStore(outboxStore));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["A"] } });
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(true);

		// The save call includes both snapshot and events
		const executeSave = saved[1]; // second save (first was create)
		expect(executeSave.snapshot.state).toBe("Placed");
		expect(executeSave.events).toEqual([
			{ type: "OrderPlaced", data: { orderId: "order-1" } },
		]);
		expect(executeSave.expectedVersion).toBe(1);
	});

	test("events are empty array when no events emitted", async () => {
		const saved: SaveOptions[] = [];
		const outboxStore: StoreAdapter = {
			data: new Map(),
			async load(id) { return this.data.get(id) ?? null; },
			async save(options) {
				saved.push(options);
				this.data.set(options.id, {
					snapshot: options.snapshot,
					version: (options.expectedVersion) + 1,
				});
			},
		};

		const executor = new WorkflowExecutor(orderRouter);
		executor.use(withStore(outboxStore));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		const createSave = saved[0];
		expect(createSave.events).toEqual([]);
	});

	test("failed dispatch does not save events", async () => {
		const saved: SaveOptions[] = [];
		const outboxStore: StoreAdapter = {
			data: new Map(),
			async load(id) { return this.data.get(id) ?? null; },
			async save(options) {
				saved.push(options);
				this.data.set(options.id, {
					snapshot: options.snapshot,
					version: (options.expectedVersion) + 1,
				});
			},
		};

		const executor = new WorkflowExecutor(orderRouter);
		executor.use(withStore(outboxStore));

		await executor.create("order-1", { initialState: "Placed", data: { items: [], placedAt: new Date() } });
		// Place is not valid in Placed state
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		// Only one save (the create) — no save for the failed dispatch
		expect(saved).toHaveLength(1);
	});
});
```

## Wiring Example: Cloudflare Durable Object

```typescript
export class OrderDO {
	private executor: WorkflowExecutor;
	private subscribers = createSubscriberRegistry();

	constructor(state: DurableObjectState) {
		this.executor = new WorkflowExecutor(orderRouter);
		this.executor.use(withStore(durableObjectStore(state)));
		this.executor.use(withBroadcast(this.subscribers));
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") === "websocket") {
			return handleWebSocket(request, this.subscribers, this.executor);
		}

		const api = createFetch(
			{ order: this.executor },
			durableObjectStore(this.state),
		);
		return api(request);
	}
}
```

## Wiring Example: Node.js / Hono

```typescript
const subscribers = createSubscriberRegistry();
const store = postgresStore(pool);

const orders = new WorkflowExecutor(orderRouter);
orders.use(withStore(store));
orders.use(withBroadcast(subscribers));

const app = new Hono();
const api = createFetch({ order: orders }, store);

app.all("/api/:name/:id", (c) => api(c.req.raw));
app.get("/ws/:id", (c) => handleWebSocket(c.req.raw, subscribers, orders));
app.get("/sse/:id", (c) => handleSSE(c.req.raw, subscribers));
```

## Wiring Example: Outbox with Postgres

```typescript
const store = postgresOutboxStore(pool);

const orders = new WorkflowExecutor(orderRouter);
orders.use(withStore(store));
orders.use(withBroadcast(subscribers));

// Executor doesn't know about the outbox — it's in the store adapter.
// Events are passed to store.save() via SaveOptions.events.
// The store adapter persists them in the same transaction as the snapshot.

// Separate process: poll outbox, publish to Kafka, send emails, etc.
setInterval(() => processOutbox(pool), 5000);
```
