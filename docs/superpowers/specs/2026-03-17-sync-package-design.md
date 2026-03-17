# Server-Side Sync Design

## Overview

Add server-side synchronization to the Ryte ecosystem. Commands flow from client to server via HTTP, state updates flow back via SSE. Multi-client support — multiple browsers/tabs can watch the same workflow and see each other's changes in real time.

## Package Structure

### `@rytejs/sync` (new package)

Framework-agnostic sync transport with pluggable adapters and a server-side broadcaster.

```
packages/sync/
├── src/
│   ├── index.ts                  # Public client API
│   ├── types.ts                  # Transport interfaces
│   ├── compose.ts                # composeSyncTransport()
│   ├── transports/
│   │   ├── http-command.ts       # httpCommandTransport()
│   │   └── sse-update.ts        # sseUpdateTransport()
│   ├── server/
│   │   ├── broadcaster.ts        # createBroadcaster()
│   │   └── types.ts              # Server-side types
│   └── testing/
│       ├── mock-command.ts       # mockCommandTransport()
│       └── mock-update.ts        # mockUpdateTransport()
├── __tests__/
├── package.json
├── tsup.config.ts
└── vitest.config.ts
```

**Exports:**

```ts
// Client — "@rytejs/sync"
export type { CommandTransport, UpdateTransport, SyncTransport }
export type { CommandResult, Subscription, TransportError, UpdateMessage }
export { httpCommandTransport } from "./transports/http-command.js";
export { sseUpdateTransport } from "./transports/sse-update.js";
export { composeSyncTransport } from "./compose.js";

// Server — "@rytejs/sync/server" (subpath export)
export { createBroadcaster } from "./server/broadcaster.js";
export type { Broadcaster, BroadcasterOptions } from "./server/types.js";

// Testing — "@rytejs/sync/testing" (subpath export)
export { mockCommandTransport } from "./testing/mock-command.js";
export { mockUpdateTransport } from "./testing/mock-update.js";
```

Server and testing utilities use subpath exports to keep them out of client bundles.

**Dependencies:**
- Peer dep on `@rytejs/core` (for types: `WorkflowSnapshot`, `DispatchResult`, `WorkflowConfig`)
- No runtime dependencies — uses native `fetch` and `ReadableStream`

### `@rytejs/react` (extended)

Existing package gains sync support:
- Optional peer dep on `@rytejs/sync`
- Store accepts a `SyncTransport` in options — when present, dispatch routes through it and updates flow in via `setWorkflow()`

## Transport Interfaces

Split adapter pattern, consistent with the engine's `StoreAdapter` / `QueueAdapter` / `LockAdapter` composition:

```ts
interface CommandTransport {
	dispatch(
		workflowId: string,
		routerName: string,
		command: { type: string; payload: unknown },
	): Promise<CommandResult>;
}

type CommandResult =
	| { ok: true; snapshot: WorkflowSnapshot<WorkflowConfig>; version: number }
	| { ok: false; error: PipelineError<WorkflowConfig> | TransportError };

interface UpdateMessage {
	snapshot: WorkflowSnapshot<WorkflowConfig>;
	version: number;
}

interface UpdateTransport {
	subscribe(
		workflowId: string,
		routerName: string,
		listener: (message: UpdateMessage) => void,
	): Subscription;
}

interface Subscription {
	unsubscribe(): void;
}

interface SyncTransport extends CommandTransport, UpdateTransport {}
```

### Transport error type

Network failures, timeouts, and parse errors are not `PipelineError`s. They get their own discriminant:

```ts
interface TransportError {
	category: "transport";
	code: "NETWORK" | "TIMEOUT" | "SERVER" | "PARSE";
	message: string;
	cause?: unknown;
}
```

Consumers discriminate on `error.category` — `"transport"` vs `"validation"` / `"domain"` / etc.

### Design decisions

- **`routerName` in both dispatch and subscribe** — the engine supports multiple routers, so both transports need to know which one. `CommandTransport.dispatch()` and `UpdateTransport.subscribe()` both take `routerName`, matching `engine.execute(routerName, id, command)`.
- **`CommandResult` is a discriminated union on `ok`** — consistent with `DispatchResult`. `{ ok: true }` guarantees `snapshot` and `version` are present; `{ ok: false }` guarantees `error`.
- **`UpdateMessage` carries both `snapshot` and `version`** — `WorkflowSnapshot` doesn't include a version (versions live in the engine's `StoredWorkflow`). The version is sent alongside the snapshot so the client can detect conflicts during optimistic dispatch.
- **`subscribe` returns a `Subscription` object** — cleaner for transports that need to track connection state.
- **No global `connect()`/`disconnect()` on `UpdateTransport`** — connection lifecycle is per-subscription. SSE opens when you subscribe, closes when you unsubscribe.
- **Snapshots over the wire, not Workflows** — snapshots are JSON-safe. Client calls `definition.restore()` to hydrate.

## Built-in Implementations

### `httpCommandTransport(options)`

```ts
interface HttpCommandOptions {
	/** Base URL of the engine HTTP handler */
	url: string;
	/** Headers sent with every request (auth tokens, etc.) */
	headers?: Record<string, string> | (() => Record<string, string>);
}

function httpCommandTransport(options: HttpCommandOptions): CommandTransport;
```

- `dispatch(workflowId, routerName, command)` → `POST {url}/{routerName}/{workflowId}` with `{ type, payload }` body
- Maps to the existing engine HTTP handler's `POST /:name/:id` route
- `headers` can be a function for dynamic tokens that rotate
- Uses native `fetch` — works in browsers, Node 18+, Bun, Deno

**Note:** The current HTTP handler returns a serialized `Workflow` object (which lacks `modelVersion`), not a `WorkflowSnapshot`. The handler must be updated to return `definition.snapshot(result.workflow)` alongside `version` so `httpCommandTransport` receives a proper snapshot. This is a prerequisite change in `@rytejs/core/http`.

### `sseUpdateTransport(options)`

```ts
interface SseUpdateOptions {
	/** Base URL for SSE endpoint */
	url: string;
	/** Headers for the connection (auth, etc.) */
	headers?: Record<string, string> | (() => Record<string, string>);
	/** Reconnect delay in ms after connection drop. Default: 1000 */
	reconnectDelay?: number;
}

function sseUpdateTransport(options: SseUpdateOptions): UpdateTransport;
```

- `subscribe(workflowId, routerName, listener)` → opens fetch-based SSE connection to `{url}/{routerName}/{workflowId}/events`
- Uses a fetch-based SSE reader (`ReadableStream` parsing) instead of native `EventSource` — native `EventSource` doesn't support custom headers in browsers
- On each SSE message, parses the `UpdateMessage` JSON (`{ snapshot, version }`) and calls listener
- On connection open, server sends current snapshot immediately (solves reconnect catch-up)
- Auto-reconnects on drop with configurable delay
- Unsubscribe closes the stream

### `composeSyncTransport()`

```ts
function composeSyncTransport(adapters: {
	commands: CommandTransport;
	updates: UpdateTransport;
}): SyncTransport;
```

Merges two adapters into one `SyncTransport`. Exists for type convenience.

## Server-Side Broadcaster

```ts
interface BroadcasterOptions {
	/** The ExecutionEngine instance to wrap */
	engine: ExecutionEngine;
}

interface Broadcaster {
	/**
	 * Execute a command through the engine and broadcast the result to all
	 * subscribers. Use this instead of calling engine.execute() directly
	 * for workflows that have active subscribers.
	 */
	execute(
		routerName: string,
		workflowId: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult>;

	/**
	 * Create an SSE Response for a client subscribing to a workflow.
	 * Returns a Web Response with streaming body.
	 * Immediately sends the current snapshot on connect.
	 */
	subscribe(routerName: string, workflowId: string): Promise<Response>;

	/** Number of active connections for a workflow */
	connectionCount(workflowId: string): number;

	/** Clean up all connections */
	close(): void;
}

function createBroadcaster(options: BroadcasterOptions): Broadcaster;
```

### How it works

The `ExecutionEngine` has no hook/event system — it's a plain class with `execute()`, `create()`, and `load()`. Rather than adding an observer pattern to the engine, the broadcaster uses a **decorator pattern**: it wraps `engine.execute()`, calls through to the engine, and broadcasts the result to subscribers afterward.

1. `broadcaster.execute()` calls `engine.execute()` under the hood, then broadcasts the new snapshot to all connected SSE streams for that workflow.
2. Tracks SSE connections per workflow ID (`Map<string, Set<WritableStreamController>>`).
3. `subscribe()` returns a Web `Response` with `Content-Type: text/event-stream`.
4. On subscribe, loads current snapshot from engine and sends it as the first SSE event.
5. When a client disconnects (stream closes), automatically removes from the subscriber set.

The HTTP handler should call `broadcaster.execute()` instead of `engine.execute()` for the command endpoint. The broadcaster delegates to the engine and handles broadcasting — no changes needed to `ExecutionEngine` itself.

### Usage example (Hono)

```ts
import { createBroadcaster } from "@rytejs/sync/server";

const broadcaster = createBroadcaster({ engine });

// Command endpoint — use broadcaster.execute() instead of engine.execute()
app.post("/:routerName/:workflowId", async (c) => {
	const { routerName, workflowId } = c.req.param();
	const body = await c.req.json();
	const result = await broadcaster.execute(routerName, workflowId, body);
	return c.json(result);
});

// SSE endpoint
app.get("/:routerName/:workflowId/events", async (c) => {
	const { routerName, workflowId } = c.req.param();
	return broadcaster.subscribe(routerName, workflowId);
});
```

### What it doesn't do

- No auth — that's middleware before these endpoints
- No routing — it produces a `Response`, your framework handles the route
- No persistence of connections across server restarts — clients reconnect and get fresh snapshots

### SSE message format

```
data: {"snapshot":{...},"version":1}\n\n
```

## React Integration

### Store options

The existing `WorkflowStoreOptions` gains a `sync` field:

```ts
interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
	sync?: SyncTransport;  // NEW
}
```

Note: `initialState`/`data`/`id` remain in the `initialConfig` parameter of `createWorkflowStore()`, not in options. This matches the existing API:

```ts
const store = createWorkflowStore(
	router,
	{ state: "Draft", data: {}, id: "order-123" },
	{ sync: transport },
);
```

### Workflow ID requirement

When `sync` is provided, the `id` field in `initialConfig` becomes **effectively required** — the store needs a known ID to subscribe to server updates and dispatch commands. The `initialConfig.state` and `initialConfig.data` serve as the initial local state shown before the first SSE snapshot arrives (loading state). Once the first SSE message arrives, it replaces the local state with the server's authoritative snapshot.

If `id` is omitted with `sync`, the store throws at creation time.

### Dispatch with per-command optimistic control

The `dispatch` signature on `WorkflowStore` and `UseWorkflowReturn` gains an optional third argument. This is backward compatible — existing calls with two arguments continue to work:

```ts
dispatch<C extends CommandNames<TConfig>>(
	command: C,
	payload: CommandPayload<TConfig, C>,
	options?: { optimistic?: boolean },
): Promise<DispatchResult<TConfig>>;
```

Usage:

```ts
// Server-authoritative (default) — waits for server response
const result = await store.dispatch("PlaceOrder", { items });

// Optimistic — applies locally first, reconciles with server
const result = await store.dispatch("PlaceOrder", { items }, { optimistic: true });
```

**Server-authoritative flow:**
1. Set `isDispatching: true`
2. Send command via `CommandTransport.dispatch(workflowId, routerName, command)`
3. If `result.ok` → restore snapshot to `Workflow` via `definition.restore()`, call `setWorkflow()`
4. If `!result.ok` and `error.category === "transport"` → set `error` on snapshot, workflow unchanged
5. If `!result.ok` and error is a `PipelineError` → set `error` on snapshot, workflow unchanged
6. Set `isDispatching: false`
7. Return: wraps `CommandResult` into a `DispatchResult`. For transport errors, returns `{ ok: false, error }` where error is a `PipelineError` with `category: "unexpected"` wrapping the `TransportError` (keeping `dispatch()` return type unchanged). The `TransportError` is surfaced on `snapshot.error` for UI discrimination.

**Optimistic flow:**

The store already holds a reference to the `WorkflowRouter` (passed at creation). For optimistic dispatch, it uses the local router for instant UI feedback and the transport for server confirmation:

1. Set `isDispatching: true`, save current workflow as rollback point
2. Dispatch locally via `router.dispatch(workflow, command)` — instant UI update via `setWorkflow()`
3. Send command via `CommandTransport.dispatch()` in parallel
4. If server agrees → done, server's SSE push will be a no-op (same state)
5. If server rejects → rollback to latest known server state (not the pre-optimistic state — an SSE update from another client may have arrived), surface the error
6. If transport fails → rollback to latest known server state, surface `TransportError` on snapshot
7. Set `isDispatching: false`
8. Return: for optimistic dispatch, the local `DispatchResult` is returned immediately. Transport failures are surfaced asynchronously via `snapshot.error`.

### Subscription wiring

Automatic when `sync` is provided. On store creation, calls `UpdateTransport.subscribe(workflowId, routerName, listener)` using the workflow ID from `initialConfig.id` and `router.definition.name` as `routerName`. Incoming `UpdateMessage`s are restored via `definition.restore(message.snapshot)` and applied via `setWorkflow()`. Unsubscribes on store cleanup.

### Connection status and error type changes

Adding sync support introduces two type changes to `WorkflowStoreSnapshot`:

```ts
interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | TransportError | null;  // WIDENED
	readonly connectionStatus?: "connected" | "reconnecting" | "disconnected"; // NEW, optional
}
```

**Breaking change:** The `error` field widens from `PipelineError<TConfig> | null` to `PipelineError<TConfig> | TransportError | null`. Consumer code that passes `snapshot.error` to functions expecting only `PipelineError` will need to narrow on `error.category !== "transport"` first. This is a deliberate semver-minor change — the union widening reflects a real new error category that sync-enabled stores can produce. The `connectionStatus` field is optional to avoid further breakage.

The `UseWorkflowReturn` type also gains the optional `connectionStatus` field:

```ts
interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	// ... existing fields ...
	readonly connectionStatus?: "connected" | "reconnecting" | "disconnected"; // NEW
}
```

### Conflict handling for optimistic updates

If an SSE update arrives while an optimistic dispatch is in-flight:
- Compare the incoming `UpdateMessage.version` with what we expect
- If it's from our own in-flight command → ignore (already applied locally)
- If it's from another client → apply it, which may overwrite optimistic state. The in-flight command's server response determines if we need to re-apply or surface an error.

Simple last-write-wins at the snapshot level. No CRDT or OT complexity.

### Restore failures

If an SSE snapshot fails `definition.restore()` (schema mismatch):
1. Ignore the update
2. Set `error` with category `"transport"`, code `"PARSE"`
3. Stay on current workflow state

Safety net for version mismatches during deploys.

### Full usage example

```ts
import { composeSyncTransport, httpCommandTransport, sseUpdateTransport } from "@rytejs/sync";
import { createWorkflowStore } from "@rytejs/react";

const transport = composeSyncTransport({
	commands: httpCommandTransport({ url: "/api" }),
	updates: sseUpdateTransport({ url: "/api" }),
});

// Store created with known ID and sync transport
const store = createWorkflowStore(
	router,
	{ state: "Draft", data: {}, id: "order-123" },
	{ sync: transport },
);
```

With context:

```ts
import { createWorkflowContext } from "@rytejs/react";

const { Provider, useWorkflow } = createWorkflowContext(definition);

// In component tree — store passed to Provider
function App() {
	return (
		<Provider store={store}>
			<OrderPage />
		</Provider>
	);
}

function OrderPage() {
	const { workflow, state, dispatch, isDispatching, connectionStatus } = useWorkflow();

	return (
		<div>
			{connectionStatus === "reconnecting" && <Banner>Reconnecting...</Banner>}
			<button
				onClick={() => dispatch("PlaceOrder", { items }, { optimistic: true })}
				disabled={isDispatching}
			>
				Place Order
			</button>
		</div>
	);
}
```

## Authorization

Authz is the server's responsibility, not the sync package's:
- Transport carries credentials via configurable `headers` (static or dynamic function)
- Server middleware gates access before requests reach the engine or broadcaster
- The sync package has no concept of users, roles, or permissions

## Reconnection Strategy

Snapshot-on-reconnect:
- Client reconnects after a drop
- Server sends the current full snapshot as the first SSE event
- No version history or delta tracking required
- Simple, stateless on the server side

## Prerequisites

Changes required in existing packages before sync can be implemented:

1. **HTTP handler must return snapshots** — The current handler at `packages/core/src/http/handler.ts` returns a serialized `Workflow` object (which lacks `modelVersion`). It must be updated to return `{ ok, snapshot: definition.snapshot(result.workflow), version }` so the `httpCommandTransport` receives proper `WorkflowSnapshot` objects. Alternatively, the handler can be replaced entirely by the broadcaster's `execute()` method in sync-enabled deployments.

## Testing Strategy

### Unit tests in `@rytejs/sync`

- **`httpCommandTransport`** — tested against mock HTTP (fetch mocking). Verify URL construction, header passing, request body, response parsing, discriminated union result.
- **`sseUpdateTransport`** — test fetch-based SSE reader: message parsing (both snapshot and version from `UpdateMessage`), reconnection on drop, unsubscribe cleanup. Mock `ReadableStream`.
- **`composeSyncTransport()`** — verify delegation.
- **`createBroadcaster()`** — `broadcaster.execute()` delegates to engine and broadcasts to all subscribers, connection cleanup on stream close, snapshot-on-connect.
- **Error paths** — network failures, malformed responses, restore failures, transport error discrimination.

### Integration tests in `@rytejs/react`

- **Sync store dispatch** — server-authoritative and optimistic flows (mock transport implementations).
- **SSE updates into store** — mock `UpdateTransport` fires listeners with `UpdateMessage`, verify `useWorkflow` re-renders.
- **Optimistic rollback** — dispatch optimistically, server rejects, verify rollback to latest server state.
- **Connection status** — verify `connectionStatus` reflects transport state, is `undefined` without sync.
- **Conflict scenario** — optimistic dispatch + concurrent SSE update from another client.
- **ID requirement** — verify store throws when `sync` is provided without `id`.

### Test utilities — `@rytejs/sync/testing`

Shipped as a subpath export for consumers testing sync-enabled components without a real server:

```ts
function mockCommandTransport(
	handler: (
		workflowId: string,
		routerName: string,
		command: { type: string; payload: unknown },
	) => CommandResult,
): CommandTransport;

function mockUpdateTransport(): UpdateTransport & {
	/** Simulate server pushing an update */
	push(workflowId: string, message: UpdateMessage): void;
	/** Simulate connection drop */
	disconnect(): void;
	/** Simulate reconnection */
	reconnect(): void;
};
```
