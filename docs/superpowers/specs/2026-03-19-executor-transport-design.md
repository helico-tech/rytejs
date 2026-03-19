# Executor & Transport Design

## Problem

Ryte workflows are pure — state in, state out. But to use them in production you need persistence, concurrent write safety, and real-time updates to connected clients. The old `ExecutionEngine` class hardcoded a lock → load → dispatch → save flow with no extensibility. We need a minimal abstraction that provides Durable Object-like functionality (versioned writes, snapshot + event broadcast) and wires cleanly into any runtime (Cloudflare Workers, Node, Deno, Bun).

## Architecture

```
Workflow (pure)           Executor (IO)                Client (IO)
──────────────────        ─────────────────────        ─────────────────
definition                withStore(store)             Transport
router.dispatch()         withBroadcast(subscribers)   ├─ wsTransport
  state in → state out    createExecutor(...)          ├─ sseTransport
  no side effects         all side effects             └─ pollingTransport
```

The boundary is Clean Architecture: workflows are the functional core, the executor is the imperative shell. This was already the project's intent — handlers are pure, IO happens before and after dispatch. The executor is the thing that does the before and after.

## Executor

### What it is

A composed middleware pipeline that wraps `router.dispatch()` with infrastructure concerns. Not a class — a function that returns functions.

### API

```typescript
const { execute, create } = createExecutor(
	orderRouter,
	invoiceRouter,
	withStore(memoryStore()),
	withBroadcast(subscribers),
);

// Create a workflow — runs through middleware pipeline
const createResult = await create("order", "order-123", {
	initialState: "Draft",
	data: { items: [] },
});

// Execute a command — runs through middleware pipeline
const execResult = await execute("order", "order-123", {
	type: "PlaceOrder",
	payload: { items: [{ sku: "A", qty: 1 }] },
});
```

### `createExecutor` signature

```typescript
function createExecutor(
	...args: Array<WorkflowRouter<any> | ExecutorMiddleware>
): { execute: Executor; create: Creator };

type Executor = (
	routerName: string,
	id: string,
	command: { type: string; payload: unknown },
) => Promise<ExecutionResult>;

type Creator = (
	routerName: string,
	id: string,
	init: { initialState: string; data: unknown },
) => Promise<ExecutionResult>;
```

`createExecutor` partitions its arguments: `WorkflowRouter` instances go in a router map, everything else is middleware. Both `execute` and `create` run through the same middleware pipeline. The difference is the core handler (innermost function):

- **execute**: loads stored workflow, calls `router.dispatch()`, produces new snapshot + events
- **create**: calls `definition.createWorkflow()`, produces initial snapshot, no events

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
	| { category: "restore"; id: string; issues: unknown[] };
```

### ExecutorContext

The context that flows through engine middleware:

```typescript
interface ExecutorContext {
	// Immutable — always available
	readonly operation: "create" | "execute";
	readonly id: string;
	readonly routerName: string;
	readonly command: { type: string; payload: unknown } | null; // null for create
	readonly init: { initialState: string; data: unknown } | null; // null for execute

	// Mutable — populated by middleware
	stored: StoredWorkflow | null;
	result: DispatchResult | null;
	snapshot: WorkflowSnapshot | null;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}
```

### ExecutorMiddleware

```typescript
type ExecutorMiddleware = (
	ctx: ExecutorContext,
	next: () => Promise<void>,
) => Promise<void>;
```

Same signature as router middleware — Koa-style onion model, reuses the existing `compose()` function.

## Built-in Middleware

### `withStore(store: StoreAdapter)`

Handles persistence. Before `next()`: loads the stored workflow (for execute) or validates non-existence (for create). After `next()`: saves the new snapshot with version check and outbox events.

```typescript
function withStore(store: StoreAdapter): ExecutorMiddleware {
	return async (ctx, next) => {
		if (ctx.operation === "execute") {
			const stored = await store.load(ctx.id);
			if (!stored) { /* set not_found error, return */ }
			ctx.stored = stored;
		} else {
			const existing = await store.load(ctx.id);
			if (existing) { /* set already_exists error, return */ }
		}

		await next();

		if (ctx.result?.ok || ctx.operation === "create") {
			await store.save({
				id: ctx.id,
				snapshot: ctx.snapshot!,
				expectedVersion: ctx.stored?.version ?? 0,
				events: ctx.events,
			});
			ctx.version = (ctx.stored?.version ?? 0) + 1;
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

		if (ctx.snapshot && ctx.version > 0) {
			subscribers.notify(ctx.id, {
				snapshot: ctx.snapshot,
				version: ctx.version,
				events: ctx.events,
			});
		}
	};
}
```

### SubscriberRegistry

```typescript
interface SubscriberRegistry {
	subscribe(id: string, callback: (message: BroadcastMessage) => void): () => void;
	notify(id: string, message: BroadcastMessage): void;
}

function createSubscriberRegistry(): SubscriberRegistry;
```

In-memory map of workflow ID → set of callbacks. Transport server-side handlers add/remove subscribers.

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

A Postgres store saves both in one transaction. A memory store can ignore the events field. A separate process polls the outbox for durable event processing — that is a user concern, not a core concern.

### StoredWorkflow and StoreAdapter — unchanged

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

### Server-Side Transport Helpers

Runtime-agnostic functions using standard Web APIs (`Request`/`Response`):

```typescript
function handleWebSocket(
	req: Request,
	subscribers: SubscriberRegistry,
	execute: Executor,
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

Thin fetch handler over the executor. Maps HTTP methods to executor operations.

```typescript
function createFetch(
	execute: Executor,
	create: Creator,
	store: StoreAdapter,
): (request: Request) => Promise<Response>;
```

Routes:
- **GET** `/:routerName/:id` → `store.load(id)` → 200 `{ snapshot, version }`
- **PUT** `/:routerName/:id` → `create(routerName, id, body)` → 201 `{ snapshot, version }`
- **POST** `/:routerName/:id` → `execute(routerName, id, body)` → 200 `{ snapshot, version, events }`

Error mapping:
- `not_found` → 404
- `conflict` → 409
- `already_exists` → 409
- `validation` → 400
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
- On `CONFLICT`: re-fetches latest snapshot from transport result, surfaces error to UI
- Subscribes to `transport.subscribe()` on creation — incoming broadcasts update the local workflow
- `store.cleanup()` calls `subscription.unsubscribe()`

When `transport` is absent: works locally like today, no changes.

## What Gets Removed

- `ExecutionEngine` class
- `LockAdapter` interface + `memoryLock()` — version check is sufficient concurrency control
- `QueueAdapter` interface + `memoryQueue()` — events are data in the result, user processes them
- `TransactionalAdapter` interface — outbox pattern via `SaveOptions.events` replaces it
- `createHandler()` — replaced by `createFetch`

## What Gets Added

| Item | Location | ~Lines |
|---|---|---|
| `createExecutor` | `core/src/executor/executor.ts` | 50 |
| `ExecutorContext`, `ExecutorMiddleware`, types | `core/src/executor/types.ts` | 40 |
| `withStore` | `core/src/executor/with-store.ts` | 30 |
| `withBroadcast` + `createSubscriberRegistry` | `core/src/executor/with-broadcast.ts` | 40 |
| `Transport` interface + types | `core/src/transport/types.ts` | 30 |
| `wsTransport` | `core/src/transport/ws.ts` | 60 |
| `sseTransport` | `core/src/transport/sse.ts` | 50 |
| `pollingTransport` | `core/src/transport/polling.ts` | 40 |
| Server-side transport helpers | `core/src/transport/server.ts` | 80 |
| `createFetch` | `core/src/http/http.ts` | 60 |
| React store transport integration | `react/src/store.ts` | 40 |

## What Stays Unchanged

Router, definition, dispatch, middleware, hooks, plugins, snapshots, migrations, context, compose, memory store (used for testing/dev), otel plugin, testing utilities.

## Wiring Example: Cloudflare Durable Object

```typescript
export class OrderDO {
	private execute: Executor;
	private create: Creator;
	private subscribers = createSubscriberRegistry();

	constructor(state: DurableObjectState) {
		const { execute, create } = createExecutor(
			orderRouter,
			withStore(durableObjectStore(state)),
			withBroadcast(this.subscribers),
		);
		this.execute = execute;
		this.create = create;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.headers.get("Upgrade") === "websocket") {
			return handleWebSocket(request, this.subscribers, this.execute);
		}

		// Standard HTTP API
		const api = createFetch(this.execute, this.create, durableObjectStore(this.state));
		return api(request);
	}
}
```

## Wiring Example: Node.js / Hono

```typescript
const subscribers = createSubscriberRegistry();

const { execute, create } = createExecutor(
	orderRouter,
	withStore(postgresStore(pool)),
	withBroadcast(subscribers),
);

const app = new Hono();
const api = createFetch(execute, create, postgresStore(pool));

app.all("/api/:router/:id", (c) => api(c.req.raw));
app.get("/ws/:id", (c) => handleWebSocket(c.req.raw, subscribers, execute));
app.get("/sse/:id", (c) => handleSSE(c.req.raw, subscribers));
```
