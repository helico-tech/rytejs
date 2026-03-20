# Documentation Infrastructure Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a progressive "Infrastructure" sidebar section to the docs, rename Engine → Executor, create 5 new guide pages with compilable snippets, and update React/Observability pages for the new transport paradigm.

**Architecture:** Five new progressive guide pages (Persistence → HTTP API → Real-time → Transports → Putting It Together) with compilable snippet files. Each page adds one layer, building from a bare executor to a full stack comparable to a Cloudflare Durable Object. Plus updates to existing Executor, React, and Observability pages.

**Tech Stack:** VitePress, TypeScript snippets with `#region` markers, imports from `@rytejs/core`, `@rytejs/core/executor`, `@rytejs/core/engine`, `@rytejs/core/http`, `@rytejs/core/transport`, `@rytejs/core/transport/server`, `@rytejs/otel`

---

### Task 1: Rename Engine to Executor

**Files:**
- Rename: `docs/snippets/guide/engine.ts` → `docs/snippets/guide/executor.ts`
- Rename: `docs/guide/engine.md` → `docs/guide/executor.md`
- Modify: `docs/guide/executor.md`

- [ ] **Step 1: Rename files**

```bash
cd /home/ralph/ryte
git mv docs/snippets/guide/engine.ts docs/snippets/guide/executor.ts
git mv docs/guide/engine.md docs/guide/executor.md
```

- [ ] **Step 2: Update executor.md content**

In `docs/guide/executor.md`, make these changes:

1. Change the title from `# Engine` to `# Executor`

2. Add this callout after the opening paragraph (before "## Why Use the Executor"):

```markdown
::: tip Progressive Walkthrough
For a step-by-step guide to building a full server-side stack, see the [Infrastructure](/guide/persistence) section.
:::
```

3. Replace all `engine.ts#` with `executor.ts#` in snippet references (7 occurrences):
   - `@/snippets/guide/engine.ts#adapters` → `@/snippets/guide/executor.ts#adapters`
   - `@/snippets/guide/engine.ts#memory-store` → `@/snippets/guide/executor.ts#memory-store`
   - `@/snippets/guide/engine.ts#create-executor` → `@/snippets/guide/executor.ts#create-executor`
   - `@/snippets/guide/engine.ts#create-workflow` → `@/snippets/guide/executor.ts#create-workflow`
   - `@/snippets/guide/engine.ts#execute` → `@/snippets/guide/executor.ts#execute`
   - `@/snippets/guide/engine.ts#http-handler` → `@/snippets/guide/executor.ts#http-handler`
   - `@/snippets/guide/engine.ts#error-handling` → `@/snippets/guide/executor.ts#error-handling`

- [ ] **Step 3: Search for stale engine references**

Search all markdown files in `docs/` for remaining `/guide/engine` links and update them to `/guide/executor`. The sidebar config will be updated in Task 2. Stage any files modified in this step.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -u docs/
git commit -m "docs: rename Engine to Executor"
git push
```

---

### Task 2: Update VitePress Sidebar Config

**Files:**
- Modify: `docs/.vitepress/config.ts`

- [ ] **Step 1: Update sidebar**

In `docs/.vitepress/config.ts`, in the `/guide/` sidebar array:

1. In the "Packages" section (currently at line 50-55), rename Engine → Executor:

```typescript
{
	text: "Packages",
	items: [
		{ text: "Executor", link: "/guide/executor" },
		{ text: "React", link: "/guide/react" },
	],
},
```

2. Add the "Infrastructure" section immediately after the "Packages" section:

```typescript
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

- [ ] **Step 2: Commit**

```bash
git add docs/.vitepress/config.ts
git commit -m "docs: update sidebar with Executor rename and Infrastructure section"
git push
```

---

### Task 3: Persistence Page

**Files:**
- Create: `docs/snippets/guide/persistence.ts`
- Create: `docs/guide/persistence.md`

- [ ] **Step 1: Build core (ensure dist is up to date)**

```bash
pnpm --filter @rytejs/core tsup
```

- [ ] **Step 2: Write snippet file**

Create `docs/snippets/guide/persistence.ts` with this exact content:

```typescript
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/engine";
import { memoryStore } from "@rytejs/core/engine";
import { WorkflowExecutor, withStore } from "@rytejs/core/executor";
import { taskRouter } from "../fixtures.js";

// #region executor-create
const executor = new WorkflowExecutor(taskRouter);

const result = await executor.create("task-1", {
	initialState: "Todo",
	data: { title: "Write docs", priority: 0 },
});

if (result.ok) {
	console.log(result.snapshot);
	console.log(result.version); // 0 — no store, no versioning
}
// #endregion executor-create

// #region with-store
const store = memoryStore();

const persistedExecutor = new WorkflowExecutor(taskRouter)
	.use(withStore(store));

// create() validates, creates, and persists
await persistedExecutor.create("task-2", {
	initialState: "Todo",
	data: { title: "Write docs", priority: 0 },
});

// execute() loads, dispatches, saves, returns events
const execResult = await persistedExecutor.execute("task-2", {
	type: "Start",
	payload: { assignee: "alice" },
});

if (execResult.ok) {
	console.log(execResult.snapshot); // state: "InProgress"
	console.log(execResult.events);  // [{ type: "TaskStarted", ... }]
	console.log(execResult.version); // 2
}
// #endregion with-store

// #region store-interface
const adapter: StoreAdapter = {
	async load(id: string): Promise<StoredWorkflow | null> {
		// Return { snapshot, version } if found, null if not
		throw new Error(`Not implemented: load(${id})`);
	},
	async save(options: SaveOptions): Promise<void> {
		// Persist snapshot with optimistic concurrency
		// Throw ConcurrencyConflictError if expectedVersion doesn't match
		throw new Error(`Not implemented: save(${options.id})`);
	},
};
// #endregion store-interface

// #region custom-store
// PostgreSQL adapter sketch with transactional outbox
const pgStore: StoreAdapter = {
	async load(id) {
		// const row = await db.query(
		//   "SELECT snapshot, version FROM workflows WHERE id = $1", [id]
		// );
		// return row ? { snapshot: row.snapshot, version: row.version } : null;
		throw new Error(`Not implemented: ${id}`);
	},
	async save({ id, snapshot, expectedVersion, events }) {
		// await db.transaction(async (tx) => {
		//   const updated = await tx.query(
		//     `UPDATE workflows SET snapshot = $2, version = version + 1
		//      WHERE id = $1 AND version = $3`,
		//     [id, JSON.stringify(snapshot), expectedVersion]
		//   );
		//   if (updated.rowCount === 0) throw new ConcurrencyConflictError(...);
		//   if (events?.length) {
		//     for (const event of events) {
		//       await tx.query(
		//         "INSERT INTO outbox (workflow_id, type, data) VALUES ($1, $2, $3)",
		//         [id, event.type, JSON.stringify(event.data)]
		//       );
		//     }
		//   }
		// });
		void snapshot;
		void expectedVersion;
		void events;
		throw new Error(`Not implemented: ${id}`);
	},
};
// #endregion custom-store

// #region outbox-pattern
const saveOptions: SaveOptions = {
	id: "task-1",
	snapshot: {} as SaveOptions["snapshot"],
	expectedVersion: 1,
	events: [
		{ type: "TaskStarted", data: { taskId: "task-1", assignee: "alice" } },
	],
};
// The store saves snapshot AND events in a single transaction
// No events can be lost — even if the process crashes after save
// #endregion outbox-pattern

// #region error-handling
(async () => {
	const exec = new WorkflowExecutor(taskRouter).use(withStore(memoryStore()));

	const errorResult = await exec.execute("nonexistent", {
		type: "Start",
		payload: { assignee: "alice" },
	});

	if (!errorResult.ok) {
		switch (errorResult.error.category) {
			// Executor errors
			case "not_found":
				console.log("Workflow not found");
				break;
			case "conflict":
				console.log("Version conflict — retry");
				break;
			case "already_exists":
				console.log("Workflow already exists");
				break;
			case "restore":
				console.log("Snapshot restore failed");
				break;
			// Dispatch errors from the router:
			// validation, domain, router, dependency, unexpected
			default:
				console.log("Error:", errorResult.error.category);
		}
	}
})();
// #endregion error-handling

void adapter;
void pgStore;
void saveOptions;
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS. If it fails, check that core is built (`pnpm --filter @rytejs/core tsup`) and fix any type errors.

- [ ] **Step 4: Write markdown page**

Create `docs/guide/persistence.md`:

```markdown
# Persistence

Your workflow is pure — no IO, no side effects. The executor is the IO shell that loads, saves, and coordinates.

## The Executor

The `WorkflowExecutor` wraps a router with `create()` and `execute()` methods. Both return `ExecutionResult` — they never throw.

<<< @/snippets/guide/persistence.ts#executor-create

Without middleware, the executor validates and dispatches but doesn't persist. Add `withStore` to save state between calls.

## Adding Persistence

The `withStore` middleware loads the workflow before dispatch and saves it after:

<<< @/snippets/guide/persistence.ts#with-store

Internally, `withStore` follows this sequence:

1. **create**: check for duplicates → dispatch to core handler → save snapshot
2. **execute**: load from store → restore workflow → dispatch command → save snapshot

## StoreAdapter Interface

The executor delegates persistence to a `StoreAdapter`:

<<< @/snippets/guide/persistence.ts#store-interface

| Method | Responsibility |
| --- | --- |
| `load(id)` | Return `{ snapshot, version }` or `null` |
| `save(options)` | Persist snapshot with optimistic concurrency |

## Optimistic Concurrency

Every save includes an `expectedVersion`. If the stored version doesn't match, the adapter throws `ConcurrencyConflictError`. This provides safe concurrent access without locks — the first writer wins, others retry.

## The Outbox Pattern

`SaveOptions` includes an `events` field. When your store adapter saves the snapshot and events in a single transaction, you get the **outbox pattern** — atomic state + event persistence with no lost events:

<<< @/snippets/guide/persistence.ts#outbox-pattern

## Custom Store

Here's a PostgreSQL adapter sketch with transaction-based outbox:

<<< @/snippets/guide/persistence.ts#custom-store

## Error Categories

The executor distinguishes between executor-level errors and dispatch errors that pass through from the router:

**Executor errors:** `not_found`, `conflict`, `already_exists`, `restore`, `unexpected`

**Dispatch errors (from router):** `validation`, `domain`, `router`, `dependency`, `unexpected`

See [Error Handling](/guide/error-handling) for the full dispatch error taxonomy.

<<< @/snippets/guide/persistence.ts#error-handling
```

- [ ] **Step 5: Commit**

```bash
git add docs/snippets/guide/persistence.ts docs/guide/persistence.md
git commit -m "docs: add Persistence page (Infrastructure layer 1)"
git push
```

---

### Task 4: HTTP API Page

**Files:**
- Create: `docs/snippets/guide/http-api.ts`
- Create: `docs/guide/http-api.md`

- [ ] **Step 1: Write snippet file**

Create `docs/snippets/guide/http-api.ts`:

```typescript
import { WorkflowRouter } from "@rytejs/core";
import { memoryStore } from "@rytejs/core/engine";
import { WorkflowExecutor, withStore } from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
import { articleWorkflow, taskRouter } from "../fixtures.js";

// #region create-fetch
const store = memoryStore();
const executor = new WorkflowExecutor(taskRouter).use(withStore(store));

const fetch = createFetch({ task: executor }, store);

// Use with any Web Standard API compatible server:
// Bun.serve({ fetch })
// Deno.serve(fetch)

// Routes:
// PUT  /task/:id   → create workflow
// POST /task/:id   → execute command
// GET  /task/:id   → load workflow
// #endregion create-fetch

// #region multiple-executors
const articleRouter = new WorkflowRouter(articleWorkflow);
const articleExecutor = new WorkflowExecutor(articleRouter).use(withStore(store));

const multiFetch = createFetch(
	{
		task: executor,
		article: articleExecutor,
	},
	store,
);

// PUT  /task/order-1     → create task workflow
// PUT  /article/post-1   → create article workflow
// POST /task/order-1     → dispatch to task executor
// POST /article/post-1   → dispatch to article executor
// #endregion multiple-executors

// #region hono-integration
// Hono example (works with any Fetch API framework)
//
// import { Hono } from "hono";
//
// const app = new Hono();
// const handler = createFetch({ task: executor }, store);
//
// app.all("/task/*", (c) => handler(c.req.raw));
//
// export default app;
// #endregion hono-integration

void fetch;
void multiFetch;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 3: Write markdown page**

Create `docs/guide/http-api.md`:

```markdown
# HTTP API

One function turns your executor into an HTTP API.

## createFetch

`createFetch` takes a map of named executors and a store, and returns a `(Request) => Promise<Response>` function compatible with any Web Standard API server:

<<< @/snippets/guide/http-api.ts#create-fetch

## Route Mapping

| Method | Path | Action |
| --- | --- | --- |
| `PUT` | `/:name/:id` | Create workflow |
| `POST` | `/:name/:id` | Execute command |
| `GET` | `/:name/:id` | Load workflow |

## Error-to-Status Mapping

Executor and dispatch errors map to HTTP status codes:

| Error Category | Status | Meaning |
| --- | --- | --- |
| `not_found` | 404 | Workflow doesn't exist |
| `conflict` | 409 | Version mismatch (optimistic locking) |
| `already_exists` | 409 | Duplicate create |
| `validation` | 400 | Invalid command payload |
| `router` | 400 | No handler for command in current state |
| `domain` | 422 | Business rule violation |
| `dependency` | 503 | External dependency failure |
| `restore` | 500 | Snapshot restore failed |
| `unexpected` | 500 | Handler threw unexpectedly |

## Multiple Workflow Types

Pass multiple executors to serve different workflow types from a single endpoint:

<<< @/snippets/guide/http-api.ts#multiple-executors

## Framework Integration

`createFetch` returns a standard `(Request) => Promise<Response>` — it works with any framework that supports the Fetch API:

| Runtime | Integration |
| --- | --- |
| **Bun** | `Bun.serve({ fetch })` |
| **Deno** | `Deno.serve(fetch)` |
| **Hono** | `app.all("/task/*", (c) => fetch(c.req.raw))` |
| **Express** | Use `@hono/node-server` or similar adapter to bridge `(req, res)` to `(Request) => Response` |

<<< @/snippets/guide/http-api.ts#hono-integration
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/http-api.ts docs/guide/http-api.md
git commit -m "docs: add HTTP API page (Infrastructure layer 2)"
git push
```

---

### Task 5: Real-time Page

**Files:**
- Create: `docs/snippets/guide/real-time.ts`
- Create: `docs/guide/real-time.md`

- [ ] **Step 1: Write snippet file**

Create `docs/snippets/guide/real-time.ts`:

```typescript
import { memoryStore } from "@rytejs/core/engine";
import {
	WorkflowExecutor,
	createSubscriberRegistry,
	withBroadcast,
	withStore,
} from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
import { handlePolling, handleSSE } from "@rytejs/core/transport/server";
import { taskRouter } from "../fixtures.js";

// #region subscriber-registry
const subscribers = createSubscriberRegistry();

// Subscribe to updates for a specific workflow
const unsubscribe = subscribers.subscribe("task-1", (message) => {
	console.log("Update:", message.snapshot, message.version);
	console.log("Events:", message.events);
});

// Later: stop listening
unsubscribe();
// #endregion subscriber-registry

// #region with-broadcast
const store = memoryStore();

const executor = new WorkflowExecutor(taskRouter)
	.use(withBroadcast(subscribers))
	.use(withStore(store));

// After a successful create/execute, all subscribers for that workflow ID
// are notified with { snapshot, version, events }
// #endregion with-broadcast

// #region middleware-ordering
// withBroadcast wraps withStore:
//
//   Request → withBroadcast → withStore → core handler
//                                         (dispatch + save)
//                              ← version set by withStore
//             ← broadcast fires with correct version
//
// If you swap the order, broadcast fires before the version is set.
const correctOrder = new WorkflowExecutor(taskRouter)
	.use(withBroadcast(subscribers))  // outer: fires after inner completes
	.use(withStore(store));           // inner: sets version after save
// #endregion middleware-ordering

// #region handle-sse
// SSE endpoint — streams updates as Server-Sent Events
const sseHandler = (req: Request) => handleSSE(req, subscribers);
// Extracts workflow ID from URL path
// Streams JSON events: { snapshot, version, events }
// Auto-cleanup on client disconnect (AbortSignal)
// #endregion handle-sse

// #region handle-polling
// Polling endpoint — returns current workflow state
const pollingHandler = (req: Request) => handlePolling(req, store);
// Extracts workflow ID from URL path
// Returns JSON: { snapshot, version }
// Returns 404 if workflow not found
// #endregion handle-polling

// #region wiring
const api = createFetch({ task: executor }, store);

const server = {
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		// SSE streaming endpoint
		if (url.pathname.startsWith("/sse/")) {
			return handleSSE(req, subscribers);
		}

		// Polling endpoint
		if (url.pathname.startsWith("/poll/")) {
			return handlePolling(req, store);
		}

		// HTTP API (create/execute/load)
		return api(req);
	},
};

// Bun.serve(server)
// Deno.serve(server.fetch)
// #endregion wiring

void correctOrder;
void sseHandler;
void pollingHandler;
void server;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 3: Write markdown page**

Create `docs/guide/real-time.md`:

```markdown
# Real-time

Your executor saves state. Now push changes to connected clients.

## SubscriberRegistry

`createSubscriberRegistry()` creates an in-memory pub/sub hub. Subscribers register for a specific workflow ID and receive broadcasts when that workflow changes:

<<< @/snippets/guide/real-time.ts#subscriber-registry

## withBroadcast

The `withBroadcast` middleware notifies subscribers after a successful save:

<<< @/snippets/guide/real-time.ts#with-broadcast

## Middleware Ordering

`withBroadcast` must wrap `withStore` (added first, runs as outer middleware). This ensures the version is set by `withStore` before the broadcast fires:

<<< @/snippets/guide/real-time.ts#middleware-ordering

## BroadcastMessage

When a subscriber is notified, it receives a `BroadcastMessage` with three fields:

| Field | Type | Description |
| --- | --- | --- |
| `snapshot` | `WorkflowSnapshot` | The full workflow snapshot after the operation |
| `version` | `number` | The new version number (set by `withStore`) |
| `events` | `Array<{ type, data }>` | Domain events emitted during dispatch |

## SSE Endpoint

`handleSSE` creates a streaming response that pushes updates via Server-Sent Events:

<<< @/snippets/guide/real-time.ts#handle-sse

The client connects with `EventSource` and receives JSON messages with `{ snapshot, version, events }`. The connection automatically cleans up when the client disconnects.

## Polling Endpoint

`handlePolling` returns the current workflow state. Clients detect changes by comparing the version number:

<<< @/snippets/guide/real-time.ts#handle-polling

## Wiring It Up

Combine the executor, store, broadcast, and real-time endpoints into a full server:

<<< @/snippets/guide/real-time.ts#wiring
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/real-time.ts docs/guide/real-time.md
git commit -m "docs: add Real-time page (Infrastructure layer 3)"
git push
```

---

### Task 6: Transports Page

**Files:**
- Create: `docs/snippets/guide/transports.ts`
- Create: `docs/guide/transports.md`

- [ ] **Step 1: Write snippet file**

Create `docs/snippets/guide/transports.ts`:

```typescript
import type {
	BroadcastMessage,
	Transport,
	TransportError,
	TransportResult,
	TransportSubscription,
} from "@rytejs/core/transport";
import { pollingTransport, sseTransport, wsTransport } from "@rytejs/core/transport";

// #region transport-interface
// The Transport interface — two methods: dispatch + subscribe
const transport: Transport = {
	async dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult> {
		// Send command to server, return result
		void id;
		void command;
		void expectedVersion;
		throw new Error("Not implemented");
	},

	subscribe(
		id: string,
		callback: (message: BroadcastMessage) => void,
	): TransportSubscription {
		// Listen for server-pushed updates
		void id;
		void callback;
		return { unsubscribe() {} };
	},
};
// #endregion transport-interface

// #region sse-transport
// SSE transport — POST for dispatch, EventSource for subscribe
const sse = sseTransport("http://localhost:3000/task");

// Dispatch sends POST to http://localhost:3000/task/:id
// Subscribe connects EventSource to http://localhost:3000/task/:id
// #endregion sse-transport

// #region polling-transport
// Polling transport — POST for dispatch, interval polling for subscribe
const polling = pollingTransport("http://localhost:3000/task", 3000);

// Dispatch sends POST to http://localhost:3000/task/:id
// Subscribe polls GET http://localhost:3000/task/:id every 3 seconds
// Only fires callback when version changes
// #endregion polling-transport

// #region ws-transport
// WebSocket transport — not yet implemented
// WebSocket upgrade varies across runtimes:
//   Cloudflare: WebSocketPair
//   Deno: Deno.upgradeWebSocket
//   Node: ws library
// Use sseTransport or pollingTransport until a runtime-specific WS adapter ships
const ws = wsTransport("ws://localhost:3000/task");
// #endregion ws-transport

// #region error-handling
// TransportResult follows the same result pattern
const handleResult = (result: TransportResult) => {
	if (result.ok) {
		console.log("Success:", result.snapshot, result.version);
		return;
	}

	const error = result.error;
	if (error.category === "transport") {
		const transportError = error as TransportError;
		switch (transportError.code) {
			case "NETWORK":
				console.log("Network error — check connectivity");
				break;
			case "CONFLICT":
				console.log("Version conflict — refetch and retry");
				break;
			case "NOT_FOUND":
				console.log("Workflow not found");
				break;
			case "TIMEOUT":
				console.log("Request timed out");
				break;
		}
	} else {
		// Domain/validation errors pass through from the server
		console.log("Server error:", error.category);
	}
};
// #endregion error-handling

void transport;
void sse;
void polling;
void ws;
void handleResult;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 3: Write markdown page**

Create `docs/guide/transports.md`:

```markdown
# Transports

Your server pushes updates. Now connect from the client.

## The Transport Interface

A `Transport` has two methods: `dispatch` sends commands to the server, `subscribe` listens for server-pushed updates:

<<< @/snippets/guide/transports.ts#transport-interface

## SSE Transport

`sseTransport` uses POST for dispatch and EventSource for subscribe — low latency with automatic reconnection:

<<< @/snippets/guide/transports.ts#sse-transport

## Polling Transport

`pollingTransport` uses POST for dispatch and interval polling for subscribe. Only fires the callback when the version changes:

<<< @/snippets/guide/transports.ts#polling-transport

## WebSocket Transport

<<< @/snippets/guide/transports.ts#ws-transport

## When to Use Which

| | SSE | Polling | WebSocket |
| --- | --- | --- | --- |
| **Latency** | Low (push) | High (interval) | Lowest (full-duplex) |
| **Complexity** | Low | Lowest | Highest |
| **Browser support** | All modern | All | All modern |
| **Server requirements** | Long-lived connections | Stateless | Upgrade support |
| **Best for** | Most use cases | Simple setups, serverless | High-frequency updates |

## Error Handling

`TransportResult` follows the same result pattern. Transport-level errors use the `transport` category with specific codes:

<<< @/snippets/guide/transports.ts#error-handling
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/transports.ts docs/guide/transports.md
git commit -m "docs: add Transports page (Infrastructure layer 4)"
git push
```

---

### Task 7: Putting It Together Page

**Files:**
- Create: `docs/snippets/guide/putting-it-together.ts`
- Create: `docs/guide/putting-it-together.md`

- [ ] **Step 1: Write snippet file**

Create `docs/snippets/guide/putting-it-together.ts`:

```typescript
import { memoryStore } from "@rytejs/core/engine";
import {
	WorkflowExecutor,
	createSubscriberRegistry,
	withBroadcast,
	withStore,
} from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
import { sseTransport } from "@rytejs/core/transport";
import { handleSSE } from "@rytejs/core/transport/server";
import { taskRouter } from "../fixtures.js";

// #region full-server
const store = memoryStore();
const subscribers = createSubscriberRegistry();

const executor = new WorkflowExecutor(taskRouter)
	.use(withBroadcast(subscribers))
	.use(withStore(store));

const api = createFetch({ task: executor }, store);

const server = {
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		if (url.pathname.startsWith("/sse/")) {
			return handleSSE(req, subscribers);
		}

		return api(req);
	},
};

// Bun.serve(server)
// Deno.serve(server.fetch)
// #endregion full-server

// #region full-client
const transport = sseTransport("http://localhost:3000/task");

// In your React app:
//
//   import { createWorkflowStore } from "@rytejs/react";
//
//   const store = createWorkflowStore(
//     taskRouter,
//     { state: "Todo", data: { title: "Write docs", priority: 0 }, id: "task-1" },
//     { transport },
//   );
//
//   // Dispatches go through the server
//   await store.dispatch("Start", { assignee: "alice" });
//
//   // Incoming broadcasts update the store automatically
//   // Call store.cleanup() on unmount
// #endregion full-client

void server;
void transport;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 3: Write markdown page**

Create `docs/guide/putting-it-together.md`:

```markdown
# Putting It Together

You've built the pieces. Here's the full picture — and why it looks a lot like a Durable Object.

## Full Server

A complete server with executor, persistence, broadcasting, and real-time in ~20 lines:

<<< @/snippets/guide/putting-it-together.ts#full-server

## Full Client

Connect from the client with a transport-backed store:

<<< @/snippets/guide/putting-it-together.ts#full-client

## What You Built

```
Client → Transport → HTTP API → Executor Pipeline → Store/Broadcast → Client
         (SSE/Poll)   (createFetch)  (withBroadcast → withStore → core)
```

Each layer is independent and composable. You can use the executor without HTTP, HTTP without real-time, or real-time without a client transport.

## Comparison with Durable Objects

| Concern | Ryte | Durable Objects |
| --- | --- | --- |
| **Single-threaded execution** | Optimistic concurrency (no actor model, but same safety guarantee) | Single-threaded actor per ID |
| **Persistent state** | Store adapter + outbox pattern | Built-in transactional storage |
| **Real-time** | SSE/polling via SubscriberRegistry | WebSocket pairs |
| **Portability** | Node, Deno, Bun, Cloudflare, edge | Cloudflare only |
| **Type-safe commands** | Zod validation + discriminated unions | Raw messages |

## What DOs Give You (That Ryte Doesn't Yet)

- **Automatic placement** — DOs are created at the edge, close to the user
- **Hibernation** — DOs sleep when idle and wake on request
- **Alarms** — scheduled execution without external cron
- **Global uniqueness guarantee** — platform ensures exactly one instance per ID

These could be added as executor middleware or platform-specific adapters.

## What Ryte Gives You (That DOs Don't)

- **Pure domain logic** — handlers have no IO, easier to test and reason about
- **Composable middleware** — add persistence, broadcast, tracing with `.use()`
- **Schema migrations** — evolve stored state safely with migration pipelines
- **Pluggable transports** — SSE, polling, WebSocket — swap without changing business logic
- **Framework-agnostic** — run on any runtime, deploy anywhere
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/putting-it-together.ts docs/guide/putting-it-together.md
git commit -m "docs: add Putting It Together page (Infrastructure layer 5)"
git push
```

---

### Task 8: Update React Page for Transport

**Files:**
- Modify: `docs/snippets/guide/react.ts`
- Modify: `docs/guide/react.md`

- [ ] **Step 1: Update snippet file**

In `docs/snippets/guide/react.ts`, make these changes:

1. Add imports near the top (after the existing `@rytejs/core` imports):

```typescript
import type { Transport } from "@rytejs/core/transport";
import { sseTransport } from "@rytejs/core/transport";
```

2. Update the declared `WorkflowStoreOptions` interface (around line 70) to add `transport`:

```typescript
interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
	transport?: Transport;
}
```

3. Update the declared `WorkflowStore` interface (around line 53) to add `cleanup`:

```typescript
interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig>;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	setWorkflow(workflow: Workflow<TConfig>): void;
	cleanup(): void;
}
```

4. Add new regions before the final `void` statements:

```typescript
// ── #transport-store ──────────────────────────────────────────────────────

// #region transport-store
const transportInstance = sseTransport("http://localhost:3000/task");

const transportStore = createWorkflowStore(
	router,
	{
		state: "Todo",
		data: { title: "Write docs", priority: 0 },
		id: "task-1", // Required when using transport
	},
	{ transport: transportInstance },
);

// Dispatch goes through the server instead of locally
await transportStore.dispatch("Start", { assignee: "alice" });

// Incoming broadcasts update the store automatically
// #endregion transport-store

// ── #transport-cleanup ──────────────────────────────────────────────────

// #region transport-cleanup
// Unsubscribe from transport when done (e.g., React component unmount)
transportStore.cleanup();
// #endregion transport-cleanup
```

5. Add to the `void` statements at the bottom:

```typescript
void transportStore;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 3: Update markdown page**

In `docs/guide/react.md`, make these changes:

1. Add a "Transport" section after the existing "Persistence" section (before "## Next Steps"):

```markdown
## Transport

Pass a `transport` option to `createWorkflowStore` to dispatch commands through a server instead of locally. The server becomes the authority — dispatches go through the executor pipeline, and broadcasts push updates back to the client.

<<< @/snippets/guide/react.ts#transport-store

Transport mode requires an `id` on the initial config — the server needs to know which workflow to dispatch against.

### Real-time Updates

When using a transport, the store automatically subscribes to server broadcasts. Incoming updates replace the local workflow state and trigger re-renders.

### Cleanup

Call `cleanup()` to unsubscribe from the transport when the store is no longer needed:

<<< @/snippets/guide/react.ts#transport-cleanup
```

2. Add a transport link to the "Next Steps" list:

```markdown
- [Transports](/guide/transports) -- connect to a server with SSE or polling
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/react.ts docs/guide/react.md
git commit -m "docs: add Transport section to React page"
git push
```

---

### Task 9: Update Observability Page for Executor Tracing

**Files:**
- Modify: `docs/snippets/guide/observability-otel.ts`
- Modify: `docs/guide/observability.md`

- [ ] **Step 1: Update snippet file**

In `docs/snippets/guide/observability-otel.ts`, make these changes:

1. Add import for `WorkflowExecutor`:

```typescript
import { WorkflowExecutor } from "@rytejs/core/executor";
```

2. Update the `@rytejs/otel` import to include `createOtelExecutorPlugin`:

```typescript
import { createOtelExecutorPlugin, createOtelPlugin } from "@rytejs/otel";
```

3. Update the fixtures import to include `taskRouter`:

```typescript
import { taskRouter, taskWorkflow } from "../fixtures.js";
```

4. Add new regions after the existing `#endregion custom`:

```typescript
// #region executor-plugin
const executor = new WorkflowExecutor(taskRouter);
executor.use(createOtelExecutorPlugin());

// Traces executor operations:
// - ryte.execute.{commandType} spans for execute()
// - ryte.create spans for create()
// - Attributes: ryte.workflow.id, ryte.operation, ryte.command.type
// #endregion executor-plugin

// #region full-stack-tracing
// Router-level: dispatch spans, transition events, metrics
const tracedRouter = new WorkflowRouter(taskWorkflow);
tracedRouter.use(createOtelPlugin());

// Executor-level: operation spans wrapping the router dispatch
const tracedExecutor = new WorkflowExecutor(tracedRouter);
tracedExecutor.use(createOtelExecutorPlugin());

// End-to-end: executor span → router dispatch span → handler
// #endregion full-stack-tracing
```

5. Update the `void` statements at the bottom:

```typescript
void router;
void customRouter;
void executor;
void tracedRouter;
void tracedExecutor;
```

The full updated file should look like:

```typescript
import { WorkflowRouter } from "@rytejs/core";
import { WorkflowExecutor } from "@rytejs/core/executor";
import { createOtelExecutorPlugin, createOtelPlugin } from "@rytejs/otel";
import { taskRouter, taskWorkflow } from "../fixtures.js";

// #region install
const router = new WorkflowRouter(taskWorkflow);
router.use(createOtelPlugin());
// #endregion install

// #region custom
declare const trace: { getTracer(name: string): unknown };
declare const metrics: { getMeter(name: string): unknown };

const customRouter = new WorkflowRouter(taskWorkflow);
customRouter.use(
	createOtelPlugin({
		// biome-ignore lint/suspicious/noExplicitAny: external OTel Tracer type
		tracer: trace.getTracer("my-service") as any,
		// biome-ignore lint/suspicious/noExplicitAny: external OTel Meter type
		meter: metrics.getMeter("my-service") as any,
	}),
);
// #endregion custom

// #region executor-plugin
const executor = new WorkflowExecutor(taskRouter);
executor.use(createOtelExecutorPlugin());

// Traces executor operations:
// - ryte.execute.{commandType} spans for execute()
// - ryte.create spans for create()
// - Attributes: ryte.workflow.id, ryte.operation, ryte.command.type
// #endregion executor-plugin

// #region full-stack-tracing
// Router-level: dispatch spans, transition events, metrics
const tracedRouter = new WorkflowRouter(taskWorkflow);
tracedRouter.use(createOtelPlugin());

// Executor-level: operation spans wrapping the router dispatch
const tracedExecutor = new WorkflowExecutor(tracedRouter);
tracedExecutor.use(createOtelExecutorPlugin());

// End-to-end: executor span → router dispatch span → handler
// #endregion full-stack-tracing

void router;
void customRouter;
void executor;
void tracedRouter;
void tracedExecutor;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS

- [ ] **Step 3: Update markdown page**

In `docs/guide/observability.md`, add a new section after the existing `@rytejs/otel` section (after the line "The patterns below are still useful if you want custom observability without the `@rytejs/otel` dependency.", before `## Structured Logging`):

```markdown
## Executor Tracing

`createOtelExecutorPlugin` traces executor operations — `create()` and `execute()` calls — with span attributes for workflow ID, operation type, and command type:

<<< @/snippets/guide/observability-otel.ts#executor-plugin

Import from `@rytejs/otel` (the root export, no subpath).

### Full Stack Tracing

Combine the router plugin with the executor plugin for end-to-end traces. The executor span wraps the router dispatch span:

<<< @/snippets/guide/observability-otel.ts#full-stack-tracing
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/observability-otel.ts docs/guide/observability.md
git commit -m "docs: add Executor Tracing section to Observability page"
git push
```

---

### Task 10: Full Verification

**Files:**
- Potentially any docs files (fix issues found)

- [ ] **Step 1: Run full typecheck**

```bash
pnpm --filter @rytejs/docs run typecheck
```

Expected: PASS — all snippets compile

- [ ] **Step 2: Run full workspace check**

```bash
pnpm -w run check
```

Expected: PASS — typecheck + test + lint all green

- [ ] **Step 3: Check for broken links and stale references**

Search for references to removed/renamed concepts:

```bash
# Check for old engine references
grep -r "/guide/engine" docs/guide/ docs/.vitepress/

# Check for removed concepts
grep -r "inspect()" docs/guide/
grep -r "targets" docs/guide/*.md
grep -r "@rytejs/viz" docs/
```

Expected: No results. Fix any stale references found.

- [ ] **Step 4: Verify all new pages have sidebar entries**

Read `docs/.vitepress/config.ts` and confirm all 5 Infrastructure pages plus the Executor rename are present.

- [ ] **Step 5: Commit any fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "docs: fix issues found during verification"
git push
```
