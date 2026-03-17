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
│   └── server/
│       ├── broadcaster.ts        # createBroadcaster()
│       └── types.ts              # Server-side types
├── __tests__/
├── package.json
├── tsup.config.ts
└── vitest.config.ts
```

**Exports:**

```ts
// Client — "@rytejs/sync"
export type { CommandTransport, UpdateTransport, SyncTransport }
export type { CommandResult, Subscription, TransportError }
export { httpCommandTransport } from "./transports/http-command.js";
export { sseUpdateTransport } from "./transports/sse-update.js";
export { composeSyncTransport } from "./compose.js";

// Server — "@rytejs/sync/server" (subpath export)
export { createBroadcaster } from "./server/broadcaster.js";
export type { Broadcaster, BroadcasterOptions } from "./server/types.js";
```

Server utilities use a subpath export to keep server-only code out of client bundles.

**Dependencies:**
- Peer dep on `@rytejs/core` (for types: `WorkflowSnapshot`, `DispatchResult`, `WorkflowConfig`)
- No runtime dependencies — uses native `fetch` and `ReadableStream`

### `@rytejs/react` (extended)

Existing package gains sync support:
- Optional peer dep on `@rytejs/sync`
- Store accepts a `SyncTransport` — when present, dispatch routes through it and updates flow in via `setWorkflow()`

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

interface CommandResult {
	ok: boolean;
	snapshot?: WorkflowSnapshot<WorkflowConfig>;
	error?: PipelineError<WorkflowConfig> | TransportError;
	version?: number;
}

interface UpdateTransport {
	subscribe(
		workflowId: string,
		listener: (snapshot: WorkflowSnapshot<WorkflowConfig>) => void,
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

- **`routerName` in dispatch** — the engine supports multiple routers, so the command transport needs to know which one. Matches `engine.execute(routerName, id, command)`.
- **`CommandResult` wraps the server response** — close to but not identical to `DispatchResult`. Server returns a snapshot + version, not a hydrated `Workflow`. Restoration happens client-side.
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

- `subscribe(workflowId)` → opens fetch-based SSE connection to `{url}/{routerName}/{workflowId}/events`
- Uses a fetch-based SSE reader (`ReadableStream` parsing) instead of native `EventSource` — native `EventSource` doesn't support custom headers in browsers
- On each SSE message, parses snapshot JSON and calls listener
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
	/** The ExecutionEngine instance to observe */
	engine: ExecutionEngine;
}

interface Broadcaster {
	/**
	 * Create an SSE Response for a client subscribing to a workflow.
	 * Returns a Web Response with streaming body.
	 * Immediately sends the current snapshot on connect.
	 */
	subscribe(workflowId: string, routerName: string): Promise<Response>;

	/** Number of active connections for a workflow */
	connectionCount(workflowId: string): number;

	/** Clean up all connections */
	close(): void;
}

function createBroadcaster(options: BroadcasterOptions): Broadcaster;
```

### How it works

1. `createBroadcaster()` hooks into the engine's `dispatch:end` lifecycle — after every successful dispatch, it gets the new snapshot.
2. Tracks SSE connections per workflow ID (`Map<string, Set<WritableStreamController>>`).
3. On state change, serializes the snapshot and writes to all connected streams for that workflow.
4. `subscribe()` returns a Web `Response` with `Content-Type: text/event-stream`.
5. On subscribe, loads current snapshot from engine and sends it as the first SSE event.

### Usage example (Hono)

```ts
import { createBroadcaster } from "@rytejs/sync/server";

const broadcaster = createBroadcaster({ engine });

app.get("/:routerName/:workflowId/events", async (c) => {
	const { routerName, workflowId } = c.req.param();
	// Auth middleware already ran
	return broadcaster.subscribe(workflowId, routerName);
});
```

### What it doesn't do

- No auth — that's middleware before this endpoint
- No routing — it produces a `Response`, your framework handles the route
- No persistence of connections across server restarts — clients reconnect and get fresh snapshots

### SSE message format

```
data: {"snapshot":{...},"version":1}\n\n
```

## React Integration

### Store options

```ts
interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	initialState: StateNames<TConfig>;
	data: StateData<TConfig, StateNames<TConfig>>;
	persist?: { ... };  // existing
	sync?: SyncTransport;  // NEW
}
```

### Dispatch with per-command optimistic control

```ts
// Server-authoritative (default) — waits for server response
const result = await store.dispatch("PlaceOrder", { items });

// Optimistic — applies locally first, reconciles with server
const result = await store.dispatch("PlaceOrder", { items }, { optimistic: true });
```

**Server-authoritative flow:**
1. Set `isDispatching: true`
2. Send command via `CommandTransport.dispatch()`
3. Receive snapshot in response, restore to `Workflow`, call `setWorkflow()`
4. Set `isDispatching: false`

**Optimistic flow:**
1. Set `isDispatching: true`, save current workflow as rollback point
2. Dispatch locally via router (instant UI update)
3. Send command via `CommandTransport.dispatch()` in parallel
4. If server agrees → done, server's SSE push will be a no-op (same state)
5. If server rejects → rollback to latest known server state, surface the error
6. Set `isDispatching: false`

### Subscription wiring

Automatic when `sync` is provided. Store calls `UpdateTransport.subscribe()` for the workflow ID on creation. Incoming snapshots are restored via `definition.restore()` and applied via `setWorkflow()`. Unsubscribes on store cleanup.

### Connection status

```ts
interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | TransportError | null;
	readonly connectionStatus: "connected" | "reconnecting" | "disconnected"; // NEW
}
```

`connectionStatus` is only relevant when `sync` is configured. Without sync, it's always `"connected"`.

### Conflict handling for optimistic updates

If an SSE update arrives while an optimistic dispatch is in-flight:
- Compare the incoming snapshot's version with what we expect
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
import { createWorkflowContext } from "@rytejs/react";

const transport = composeSyncTransport({
	commands: httpCommandTransport({ url: "/api" }),
	updates: sseUpdateTransport({ url: "/api" }),
});

const { Provider, useWorkflow } = createWorkflowContext(router, {
	initialState: "Draft",
	data: {},
	sync: transport,
});

function OrderPage({ orderId }) {
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

## Testing Strategy

### Unit tests in `@rytejs/sync`

- **`httpCommandTransport`** — tested against mock HTTP (fetch mocking). Verify URL construction, header passing, request body, response parsing.
- **`sseUpdateTransport`** — test fetch-based SSE reader: message parsing, reconnection on drop, unsubscribe cleanup. Mock `ReadableStream`.
- **`composeSyncTransport()`** — verify delegation.
- **`createBroadcaster()`** — engine dispatch triggers broadcast to all subscribers, connection cleanup on stream close, snapshot-on-connect.
- **Error paths** — network failures, malformed responses, restore failures.

### Integration tests in `@rytejs/react`

- **Sync store dispatch** — server-authoritative and optimistic flows (mock transport implementations).
- **SSE updates into store** — mock `UpdateTransport` fires listeners, verify `useWorkflow` re-renders.
- **Optimistic rollback** — dispatch optimistically, server rejects, verify rollback.
- **Connection status** — verify `connectionStatus` reflects transport state.
- **Conflict scenario** — optimistic dispatch + concurrent SSE update from another client.

### Test utilities to ship

```ts
function mockCommandTransport(
	handler: (workflowId: string, routerName: string, command: { type: string; payload: unknown }) => CommandResult,
): CommandTransport;

function mockUpdateTransport(): UpdateTransport & {
	/** Simulate server pushing a snapshot */
	push(workflowId: string, snapshot: WorkflowSnapshot<WorkflowConfig>): void;
	/** Simulate connection drop */
	disconnect(): void;
	/** Simulate reconnection */
	reconnect(): void;
};
```

These let consumers test sync-enabled components without a real server.
