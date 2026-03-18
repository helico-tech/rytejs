# Cloudflare Adapters for @rytejs

## Problem

The fullstack sync example (engine execution + real-time broadcast) only works with Node.js/Bun in-memory adapters. There's no way to deploy a ryte-powered workflow app on Cloudflare Workers, which is a major target for edge-first TypeScript apps.

The core challenge is broadcast: the current `Broadcaster` holds SSE connections in an in-memory `Map<string, Set<Controller>>`, which doesn't survive across stateless Worker isolates. Storage and locking also need platform-specific implementations.

## Solution

New package `@rytejs/cloudflare` that maps ryte's adapter interfaces to Cloudflare primitives. One Durable Object per workflow provides natural single-threaded locking, SQLite-backed snapshot storage, and connection management for both WebSocket and SSE broadcast.

Additionally, a new `wsUpdateTransport` in `@rytejs/sync` provides a client-side WebSocket transport (runtime-agnostic, not Cloudflare-specific).

All Cloudflare features used are on the **free tier**: Workers, Durable Objects (SQLite backend), KV (if needed later).

## Architecture

### Package Structure

```
packages/cloudflare/
  src/
    adapters/
      store.ts          # cloudflareStore(storage) → StoreAdapter
      lock.ts           # cloudflareLock() → LockAdapter (no-op)
      broadcaster.ts    # cloudflareBroadcaster(ctx) → WS + SSE broadcast
    do/
      workflow-do.ts    # WorkflowDO base class
    helpers/
      route-to-do.ts   # routeToDO(req, env, binding) → routes to DO
    index.ts            # public exports
  package.json
  tsconfig.json
  tsup.config.ts
```

### Public Exports

```typescript
// High-level (easy path)
export { WorkflowDO } from "./do/workflow-do.js"
export { routeToDO } from "./helpers/route-to-do.js"

// Standalone adapters (composable path)
export { cloudflareStore } from "./adapters/store.js"
export { cloudflareLock } from "./adapters/lock.js"
export { cloudflareBroadcaster } from "./adapters/broadcaster.js"
```

### New in @rytejs/sync

```typescript
// New client-side transport
export { wsUpdateTransport } from "./transports/ws-update.js"
```

## Component Design

### WorkflowDO (Base Class)

Users extend this with their routers:

```typescript
import { WorkflowDO } from "@rytejs/cloudflare"
import { orderRouter } from "./workflow"

export class OrderDO extends WorkflowDO {
  routers = [orderRouter]
}
```

Internally, `WorkflowDO` extends `DurableObject` and composes:
- `cloudflareStore(this.ctx.storage)` → `StoreAdapter`
- `cloudflareLock()` → `LockAdapter` (no-op, single-threaded)
- `cloudflareBroadcaster(this.ctx)` → broadcast manager
- `ExecutionEngine` wired with the above adapters

The DO's `fetch()` method handles internal routing:

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/dispatch` | Execute command via engine, broadcast result, return `ExecutionResult` |
| GET | `/events` | SSE subscription — returns `text/event-stream` Response |
| GET | `/websocket` | WebSocket upgrade — accepts and registers connection |
| GET | `/snapshot` | Returns current snapshot + version |

The routerName and workflowId are not in the DO's URL paths — they're already resolved by `routeToDO` before the request reaches the DO. The DO receives the command type + payload in the POST body along with the routerName.

### routeToDO Helper

```typescript
function routeToDO(
  request: Request,
  env: { [binding: string]: DurableObjectNamespace },
  binding: string,
): Promise<Response>
```

Parses URL pattern `/:routerName/:workflowId/*` from the request path. Generates a deterministic DO ID via `env[binding].idFromName(`${routerName}:${workflowId}`)`, gets the stub, and forwards the request with the remaining path.

Example: `POST /order/order-123/dispatch` → DO with ID `order:order-123` receives `POST /dispatch` with routerName `order` in a header or body field.

### cloudflareStore (StoreAdapter)

```typescript
function cloudflareStore(storage: DurableObjectStorage): StoreAdapter
```

Uses DO SQLite storage. Creates table on first use:

```sql
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,
  version INTEGER NOT NULL
)
```

- `load(id)` — SELECT by ID, parse JSON snapshot, return `{ snapshot, version }` or `null`
- `save({ id, snapshot, version, expectedVersion })` — UPDATE with `WHERE version = expectedVersion`. Zero rows affected → `ConcurrencyConflictError`. New workflows → INSERT with version 1.

SQLite is synchronous within the DO, so no transaction wrapper is needed.

### cloudflareLock (LockAdapter)

```typescript
function cloudflareLock(): LockAdapter
```

No-op implementation. `acquire()` returns `true`, `release()` is a no-op. The DO's single-threaded execution model provides mutual exclusion. Exists to satisfy the `ExecutionEngine` interface.

### cloudflareBroadcaster

```typescript
function cloudflareBroadcaster(ctx: DurableObjectState): {
  handleWebSocket(request: Request): Response
  handleSSE(): Response
  broadcast(update: { snapshot: WorkflowSnapshot; version: number }): void
  connectionCount(): number
}
```

Manages two connection types simultaneously:

**WebSocket:**
- Uses Cloudflare's hibernatable WebSocket API (`ctx.acceptWebSocket()`)
- Broadcasts via `ctx.getWebSockets()` → `ws.send(JSON.stringify(update))`
- Hibernatable means the DO sleeps between messages — zero cost while idle
- Cleanup via `webSocketClose` / `webSocketError` handlers on the DO class

**SSE:**
- Creates `ReadableStream`, holds controller in a `Set`
- Broadcasts by writing `data: ${JSON.stringify(update)}\n\n` to each controller
- Cleanup via stream `cancel` signal

**Broadcast flow:**
1. Command arrives at DO via `POST /dispatch`
2. Engine executes → new snapshot + version
3. `broadcaster.broadcast({ snapshot, version })` sends to all WS + SSE clients
4. HTTP response returns `ExecutionResult` to the caller

### wsUpdateTransport (in @rytejs/sync)

```typescript
function wsUpdateTransport(options: {
  url: string
  router: string
  reconnectDelay?: number  // default 1000ms
}): UpdateTransport
```

Client-side WebSocket transport implementing the existing `UpdateTransport` interface:
- `subscribe(workflowId, listener)` → opens WebSocket to `ws(s)://${url}/${router}/${workflowId}/websocket`
- Parses incoming messages as `{ snapshot, version }` and calls listener
- Automatic reconnection with configurable delay (mirrors `sseUpdateTransport` behavior)
- Returns `Subscription` with `unsubscribe()` that closes the WebSocket

This is **not** Cloudflare-specific — any WebSocket server can use it. Lives in `@rytejs/sync`.

## End-to-End Example

**Server (Cloudflare Worker):**

```typescript
import { WorkflowDO, routeToDO } from "@rytejs/cloudflare"
import { orderRouter } from "./workflow"

export class OrderDO extends WorkflowDO {
  routers = [orderRouter]
}

export default {
  fetch(req, env) {
    return routeToDO(req, env, "WORKFLOW_DO")
  }
}
```

**Client:**

```typescript
import { composeSyncTransport, httpCommandTransport, wsUpdateTransport } from "@rytejs/sync"
import { createWorkflowStore } from "@rytejs/react"
import { orderRouter } from "./workflow"

const transport = composeSyncTransport({
  commands: httpCommandTransport({ url: "/api", router: "order" }),
  updates: wsUpdateTransport({ url: "/api", router: "order" }),
})

const store = createWorkflowStore(orderRouter, initialState, { sync: transport })
```

**wrangler.toml:**

```toml
name = "order-app"
main = "server.ts"

[[durable_objects.bindings]]
name = "WORKFLOW_DO"
class_name = "OrderDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["OrderDO"]
```

## Dependencies

`packages/cloudflare/package.json`:
- `peerDependencies`: `@rytejs/core` (for engine, router, types)
- `devDependencies`: `@cloudflare/workers-types` (for DO types, DurableObjectState, etc.)

`packages/sync/` — no new dependencies for `wsUpdateTransport` (WebSocket is a global API).

## Testing Strategy

**Unit tests** (`packages/cloudflare/src/__tests__/`):
- `store.test.ts` — mock `DurableObjectStorage` with in-memory SQLite, test load/save/version conflicts
- `lock.test.ts` — verify no-op behavior
- `broadcaster.test.ts` — mock WebSocket + SSE connections, verify broadcast reaches all clients
- `route-to-do.test.ts` — verify URL parsing and DO ID generation

**Integration test** (`examples/cloudflare-order-dashboard/`):
- Port of the existing fullstack order dashboard to Cloudflare
- Uses `wrangler dev` for local development
- Manual verification that dispatch + broadcast works end-to-end

**wsUpdateTransport tests** (`packages/sync/src/__tests__/`):
- Mock WebSocket server, verify subscribe/unsubscribe/reconnection

## What This Does NOT Include

- **Queue adapter** — not needed for the sync example. Can be added later for `@rytejs/worker` support.
- **KV adapter** — DO SQLite handles storage. KV could be added as an alternative store for read-heavy patterns.
- **Multi-region** — single DO instance per workflow. Cloudflare routes to the nearest region automatically, but the DO lives in one location. Smart placement handles this well enough for most use cases.
- **Authentication/authorization** — users handle this in their Worker `fetch` before calling `routeToDO`.
