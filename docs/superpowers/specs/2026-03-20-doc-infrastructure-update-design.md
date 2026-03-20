# Documentation Update: Infrastructure Section Design

## Goal

Update the @rytejs documentation to cover the new executor/transport paradigm. Add a progressive "Infrastructure" sidebar section that walks developers from persistence through HTTP, real-time, transports, and finally shows how the composed stack is equivalent to a Cloudflare Durable Object. Also rename the Engine page to Executor, extend the React page with transport support, and update the observability page with the executor otel plugin.

## Audience

Both library consumers (practical recipes) and architecture-curious evaluators (conceptual "why" + comparison to DurableObjects/Temporal). Each page starts with practical usage and ends with architectural context.

## Structural Changes

### Sidebar

Current "Packages" section:
```
Packages
├── Engine        → rename to "Executor"
├── React         (unchanged label)
```

New section added AFTER "Packages":
```
Infrastructure
├── Persistence
├── HTTP API
├── Real-time
├── Transports
└── Putting It Together
```

### File changes

| Action | File | Notes |
|--------|------|-------|
| Rename | `docs/guide/engine.md` → `docs/guide/executor.md` | Update title, fix internal references |
| Rename | `docs/snippets/guide/engine.ts` → `docs/snippets/guide/executor.ts` | Update `<<<` references in executor.md |
| Modify | `docs/.vitepress/config.ts` | Rename Engine→Executor, add Infrastructure section |
| Create | `docs/guide/persistence.md` | Layer 1: executor + withStore |
| Create | `docs/guide/http-api.md` | Layer 2: createFetch |
| Create | `docs/guide/real-time.md` | Layer 3: broadcast + SSE/polling server |
| Create | `docs/guide/transports.md` | Layer 4: client transports |
| Create | `docs/guide/putting-it-together.md` | Layer 5: full stack + DO comparison |
| Modify | `docs/guide/react.md` | Add Transport section |
| Modify | `docs/guide/observability.md` | Add executor otel plugin section |
| Modify | `docs/snippets/guide/observability-otel.ts` | Add `executor-plugin` and `full-stack-tracing` regions |
| Modify | `docs/snippets/guide/react.ts` | Update declared `WorkflowStoreOptions` to include `transport?: Transport`, add `cleanup()` to `WorkflowStore` interface |
| Create | `docs/snippets/guide/persistence.ts` | Snippet file for persistence page |
| Create | `docs/snippets/guide/http-api.ts` | Snippet file for HTTP API page |
| Create | `docs/snippets/guide/real-time.ts` | Snippet file for real-time page |
| Create | `docs/snippets/guide/transports.ts` | Snippet file for transports page |
| Create | `docs/snippets/guide/putting-it-together.ts` | Snippet file for full stack page |
| Modify | `docs/snippets/guide/react.ts` | Add transport regions |

### Config change

```typescript
// docs/.vitepress/config.ts sidebar additions
{
  text: "Packages",
  items: [
    { text: "Executor", link: "/guide/executor" },  // renamed from Engine
    { text: "React", link: "/guide/react" },
  ],
},
{
  text: "Infrastructure",
  items: [
    { text: "Persistence", link: "/guide/persistence" },
    { text: "HTTP API", link: "/guide/http-api" },
    { text: "Real-time", link: "/guide/real-time" },
    { text: "Transports", link: "/guide/transports" },
    { text: "Putting It Together", link: "/guide/putting-it-together" },
  ],
},
```

## Page Content

### executor.md (renamed from engine.md)

Minimal changes — rename title from "Engine" to "Executor", update snippet references from `engine.ts` to `executor.ts`, add a callout at the top:

> For a progressive walkthrough of building a full server-side stack, see the [Infrastructure](/guide/persistence) section.

Keep existing content (store interface, memory store, create/execute, HTTP handler, error handling). This serves as a quick package reference.

### persistence.md — Layer 1

**Opening:** "Your workflow is pure — no IO, no side effects. The executor is the IO shell that loads, saves, and coordinates."

**Sections:**
1. **The Executor** — `new WorkflowExecutor(router)`, result pattern (never throws), `create()` and `execute()` return `ExecutionResult`
2. **Adding Persistence** — `withStore(store)` middleware, what it does internally (load → dispatch → save)
3. **StoreAdapter Interface** — `load(id)` and `save(options)`, `ConcurrencyConflictError`
4. **Optimistic Concurrency** — version checking, why no locks are needed, conflict detection
5. **The Outbox Pattern** — `SaveOptions.events` field, atomic snapshot + events, transactional consistency
6. **Custom Store** — PostgreSQL adapter sketch with transaction-based outbox
7. **Error Categories** — executor-specific errors (`not_found`, `conflict`, `already_exists`, `restore`, `unexpected`) plus dispatch errors (`validation`, `domain`, `router`, `dependency`, `unexpected`) that pass through from the router. Cross-reference [Error Handling](/guide/error-handling) for the full dispatch error taxonomy

**Snippet regions:** `executor-create`, `with-store`, `store-interface`, `custom-store`, `outbox-pattern`, `error-handling`

### http-api.md — Layer 2

**Opening:** "One function turns your executor into an HTTP API."

**Sections:**
1. **createFetch** — `createFetch({ task: executor }, store)` returns `(Request) => Promise<Response>`
2. **Route Mapping** — table of Method/Path/Action
3. **Error-to-Status Mapping** — how executor errors map to HTTP status codes (404, 409, 400, 500)
4. **Multiple Workflow Types** — passing multiple executors to a single fetch handler
5. **Framework Integration** — short recipes for Bun.serve, Deno.serve, Hono, Express adapter

**Snippet regions:** `create-fetch`, `multiple-executors`, `hono-integration`

### real-time.md — Layer 3

**Opening:** "Your executor saves state. Now push changes to connected clients."

**Sections:**
1. **SubscriberRegistry** — `createSubscriberRegistry()`, in-memory pub/sub, `subscribe()` returns unsubscribe function
2. **withBroadcast** — middleware that notifies subscribers after successful save
3. **Middleware Ordering** — `withBroadcast` (outer) then `withStore` (inner), why this matters (store sets version before broadcast fires)
4. **BroadcastMessage** — `{ snapshot, version, events }` shape
5. **SSE Endpoint** — `handleSSE(req, subscribers)`, streaming response, cleanup on abort
6. **Polling Endpoint** — `handlePolling(req, store)`, returns current state, client detects changes via version
7. **Wiring It Up** — full server with executor + store + broadcast + SSE/polling routes

**Snippet regions:** `subscriber-registry`, `with-broadcast`, `middleware-ordering`, `handle-sse`, `handle-polling`, `wiring`

### transports.md — Layer 4

**Opening:** "Your server pushes updates. Now connect from the client."

**Sections:**
1. **The Transport Interface** — `dispatch(id, command, expectedVersion)` + `subscribe(id, callback)`, `TransportResult`, `TransportError`
2. **SSE Transport** — `sseTransport(url)`, POST for dispatch, EventSource for subscribe
3. **Polling Transport** — `pollingTransport(url, interval?)`, POST for dispatch, interval polling for subscribe, version diffing
4. **WebSocket Transport** — stub, explanation of why WS upgrade is runtime-specific, future direction
5. **When to Use Which** — comparison table (latency, complexity, browser support, server requirements)
6. **Error Handling** — `TransportError` with codes (NETWORK, CONFLICT, NOT_FOUND, TIMEOUT)

**Snippet regions:** `transport-interface`, `sse-transport`, `polling-transport`, `ws-transport`, `error-handling`

### putting-it-together.md — Layer 5

**Opening:** "You've built the pieces. Here's the full picture — and why it looks a lot like a Durable Object."

**Sections:**
1. **Full Server** — complete example wiring executor + withStore + withBroadcast + createFetch + handleSSE, all in ~30 lines
2. **Full Client** — sseTransport → React store with transport option, ~10 lines
3. **What You Built** — diagram showing the layers: Client → Transport → HTTP API → Executor Pipeline → Store/Broadcast → Client
4. **Comparison with Durable Objects** — side-by-side table:
   - Single-threaded execution: ryte uses optimistic concurrency (no actor model, but same safety)
   - Persistent state: both store snapshots, ryte adds outbox pattern
   - Real-time: both support WebSocket/SSE push
   - Portable: ryte runs anywhere (Node, Deno, Bun, Cloudflare, edge), DOs are Cloudflare-only
   - Type-safe commands: ryte validates with Zod, DOs use raw messages
5. **What DOs Give You (That Ryte Doesn't Yet)** — automatic placement, hibernation, alarms, global uniqueness guarantee. Brief notes on how these could be added.
6. **What Ryte Gives You (That DOs Don't)** — pure domain logic, composable middleware, schema migrations, pluggable transports, framework-agnostic

**Snippet regions:** `full-server`, `full-client`

### react.md update

Add a new section **"Transport"** after the existing "Persistence" section:

**Sections:**
1. **Server-Authoritative Dispatch** — `transport` option on `createWorkflowStore`, how dispatch goes through the server instead of locally
2. **Real-time Updates** — transport subscription, incoming broadcasts update local workflow automatically
3. **Cleanup** — `store.cleanup()` unsubscribes from the transport
4. **Constraint** — transport requires an `id` on the initial config (throws if missing)

**Snippet regions (in react.ts):** `transport-store`, `transport-cleanup`

**Snippet file update:** The declared `WorkflowStoreOptions` interface in `react.ts` must be updated to include `transport?: Transport`, and the `WorkflowStore` interface needs `cleanup(): void` added. These are required for the new snippet regions to typecheck.

**Update "Next Steps"** — add link to Infrastructure/Transports page.

### observability.md update

Add a section **"Executor Tracing"** after the existing router tracing content:

1. **createOtelExecutorPlugin** — traces `execute:start`/`execute:end` with span attributes for workflow ID, operation type, command type
2. **Full Stack Tracing** — combining router plugin + executor plugin for end-to-end traces

Import is from `@rytejs/otel` (the root export, no subpath — the otel package uses a single entry point).

**Snippet regions (in `observability-otel.ts`):** `executor-plugin`, `full-stack-tracing`

## Snippet Conventions

All snippet files follow existing project conventions:
- Tab indentation
- Located in `docs/snippets/guide/`
- Named `{page-name}.ts` matching the guide page
- Use `#region name` / `#endregion name` markers
- Referenced from markdown via `<<< @/snippets/guide/{file}.ts#{region}`
- Import from `@rytejs/core`, `@rytejs/core/executor`, `@rytejs/core/transport`, `@rytejs/core/transport/server`, `@rytejs/core/http`, `@rytejs/otel` (root export, no subpath)
- Reuse fixtures from `docs/snippets/fixtures.ts` where possible
- Must compile — `pnpm --filter @rytejs/docs run typecheck` validates all snippets

## Verification

After implementation:
1. `pnpm --filter @rytejs/docs run typecheck` — all snippets compile
2. `pnpm -w run check` — full workspace check passes
3. VitePress dev server renders all pages correctly
4. All internal links resolve (no broken links)
5. No references to removed concepts (inspect, targets, etc.)

## Out of Scope

- API reference generation for new subpaths (transport, transport/server, executor) — can be done separately
- New example projects — the "Putting It Together" page serves as the example
- Cloudflare Workers deployment guide — mentioned as future direction only
