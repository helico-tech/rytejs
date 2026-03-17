# Package Documentation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive guide documentation for the three undocumented packages (`@rytejs/worker`, `@rytejs/react`, `@rytejs/otel`) plus the new engine subpath (`@rytejs/core/engine`), and update the observability guide.

**Architecture:** Each package gets a guide page in `docs/guide/` with compilable snippet files in `docs/snippets/guide/`. Snippets use `#region` markers and are referenced from markdown via VitePress include syntax. The sidebar, API index, and observability guide are updated to link everything together.

**Tech Stack:** VitePress, TypeScript (compilable snippets), Zod v4

**Spec:** Approved during brainstorming — no separate spec file.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `docs/package.json` | Add `@rytejs/worker`, `@rytejs/otel` as devDependencies |
| Modify | `docs/tsconfig.snippets.json` | Add `tsx` to include pattern for React snippets |
| Create | `docs/snippets/guide/engine.ts` | Compilable engine snippet regions |
| Create | `docs/snippets/guide/worker.ts` | Compilable worker snippet regions |
| Create | `docs/snippets/guide/react.ts` | Compilable React snippet regions (no JSX — type-level only) |
| Create | `docs/snippets/guide/otel.ts` | Compilable otel snippet regions |
| Create | `docs/guide/engine.md` | Engine guide page |
| Create | `docs/guide/worker.md` | Worker guide page |
| Create | `docs/guide/react.md` | React guide page |
| Modify | `docs/guide/observability.md` | Add `@rytejs/otel` section |
| Create | `docs/snippets/guide/observability-otel.ts` | Compilable otel snippet for observability page |
| Modify | `docs/.vitepress/config.ts` | Add new pages to sidebar |
| Modify | `docs/api/index.md` | Add links to all packages |

---

## Task 1: Add devDependencies for new packages

**Files:**
- Modify: `docs/package.json`

- [ ] **Step 1: Add `@rytejs/worker` and `@rytejs/otel` to docs devDependencies**

In `docs/package.json`, add to `devDependencies`:

```json
"@rytejs/otel": "workspace:^",
"@rytejs/worker": "workspace:^"
```

Note: `@rytejs/react` snippets won't use JSX (they'll demonstrate the store/hook API at the type level using declares), so React types are not needed.

- [ ] **Step 2: Run `pnpm install`**

Run: `pnpm install`
Expected: Dependencies resolve, `@rytejs/worker` and `@rytejs/otel` linked from workspace.

- [ ] **Step 3: Rebuild core and worker dist**

Run: `cd packages/core && pnpm tsup && cd ../worker && pnpm tsup && cd ../otel && pnpm tsup`
Expected: All three packages build successfully. The docs package imports from dist, not source.

- [ ] **Step 4: Commit**

```bash
git add docs/package.json pnpm-lock.yaml
git commit -m "docs: add @rytejs/worker and @rytejs/otel as docs devDependencies"
git push
```

---

## Task 2: Engine guide — snippets and page

**Files:**
- Create: `docs/snippets/guide/engine.ts`
- Create: `docs/guide/engine.md`

- [ ] **Step 1: Create `docs/snippets/guide/engine.ts`**

This file must compile against the actual `@rytejs/core/engine` exports. Regions needed:
- `adapters` — show the adapter interfaces (StoreAdapter, LockAdapter, QueueAdapter)
- `create-engine` — creating an engine with createEngine()
- `create-workflow` — engine.create() to persist a new workflow
- `execute` — engine.execute() to dispatch a command through the engine
- `memory-adapters` — memoryStore, memoryLock, memoryQueue, memoryAdapter
- `transactional` — memoryAdapter as a transactional adapter (store === queue)
- `http-handler` — createHandler() from @rytejs/core/http
- `error-handling` — catching LockConflictError, ConcurrencyConflictError

```ts
import {
	type EngineOptions,
	type ExecutionResult,
	type LockAdapter,
	type QueueAdapter,
	type SaveOptions,
	type StoreAdapter,
	type StoredWorkflow,
	type TransactionalAdapter,
	ConcurrencyConflictError,
	LockConflictError,
	createEngine,
	memoryAdapter,
	memoryLock,
	memoryQueue,
	memoryStore,
} from "@rytejs/core/engine";
import { createHandler } from "@rytejs/core/http";
import { WorkflowRouter } from "@rytejs/core";
import { taskWorkflow, taskRouter } from "../fixtures.js";

// #region adapters
// StoreAdapter — load and save workflow snapshots
const postgresStore: StoreAdapter = {
	async load(id: string): Promise<StoredWorkflow | null> {
		// return { snapshot, version } from your database
		return null;
	},
	async save(options: SaveOptions): Promise<void> {
		// INSERT or UPDATE with optimistic concurrency (expectedVersion)
		// Throw ConcurrencyConflictError if version doesn't match
	},
};

// LockAdapter — prevent concurrent writes to the same workflow
const redisLock: LockAdapter = {
	async acquire(id: string): Promise<boolean> {
		// Try to acquire a distributed lock, return true if successful
		return true;
	},
	async release(id: string): Promise<void> {
		// Release the lock
	},
};

// QueueAdapter — enqueue and process messages
const sqsQueue: QueueAdapter = {
	async enqueue(messages) {
		// Push messages to your queue
	},
	async dequeue(count) {
		// Pull up to `count` messages
		return [];
	},
	async ack(id) {
		// Acknowledge (delete) a processed message
	},
	async nack(id, delay) {
		// Return message to queue with optional delay
	},
	async deadLetter(id, reason) {
		// Move to dead letter queue
	},
};
// #endregion adapters

// #region create-engine
const engine = createEngine({
	store: memoryStore(),
	routers: { task: taskRouter },
	lock: memoryLock({ ttl: 30_000 }),
	queue: memoryQueue(),
});
// #endregion create-engine

// #region create-workflow
const { workflow, version } = await engine.create("task", "task-1", {
	initialState: "Todo",
	data: { title: "Write docs" },
});
// workflow is a WorkflowSnapshot, version is 1
// #endregion create-workflow

// #region execute
const result: ExecutionResult = await engine.execute("task", "task-1", {
	type: "Start",
	payload: { assignee: "alice" },
});

if (result.result.ok) {
	console.log("New state:", result.result.workflow.state);
	console.log("Events:", result.events);
	console.log("Version:", result.version);
}
// #endregion execute

// #region memory-adapters
// Individual adapters — mix and match for testing
const store = memoryStore();
const lock = memoryLock({ ttl: 30_000 });
const queue = memoryQueue();

const testEngine = createEngine({
	store,
	routers: { task: taskRouter },
	lock,
	queue,
});
// #endregion memory-adapters

// #region transactional
// Combined adapter — store + queue + lock + transaction in one object
// When store === queue, the engine uses a transactional path:
// save and enqueue happen atomically, rolling back both on failure.
const adapter = memoryAdapter({ ttl: 30_000 });

const txEngine = createEngine({
	store: adapter,
	routers: { task: taskRouter },
	lock: adapter,
	queue: adapter,
});
// #endregion transactional

// #region http-handler
// Standard Request/Response HTTP handler — works with any framework
const handler = createHandler({ engine });

// With Bun
// Bun.serve({ fetch: handler });

// With Node (using a Request/Response adapter)
// The handler signature is: (request: Request) => Promise<Response>
// #endregion http-handler

// #region error-handling
try {
	await engine.execute("task", "task-1", {
		type: "Complete",
		payload: {},
	});
} catch (err) {
	if (err instanceof LockConflictError) {
		// Another process holds the lock — retry later
		console.log(`Lock conflict for ${err.workflowId}`);
	}
	if (err instanceof ConcurrencyConflictError) {
		// Version mismatch — reload and retry
		console.log(`Version conflict for ${err.workflowId}`);
	}
}
// #endregion error-handling

void postgresStore;
void redisLock;
void sqsQueue;
void testEngine;
void txEngine;
void handler;
void workflow;
void version;
void result;
```

- [ ] **Step 2: Run snippet typecheck**

Run: `cd packages/core && pnpm tsup && cd ../../docs && pnpm typecheck`
Expected: May need adjustments. Fix any type errors.

- [ ] **Step 3: Create `docs/guide/engine.md`**

```markdown
# Engine

The engine sits between your router and a database. It handles persistence, concurrency control, and event queuing — so your handlers stay pure.

## Why Use the Engine?

The [Integrations](/guide/integrations) guide shows the manual approach: snapshot, store, restore, dispatch, save. The engine wraps that into a single `execute()` call with locking and optimistic concurrency built in.

| Manual dispatch | Engine |
|---|---|
| You manage snapshot/restore | Engine loads and saves automatically |
| You implement locking | Engine acquires/releases locks |
| You track versions | Engine enforces optimistic concurrency |
| You enqueue events | Engine enqueues to a QueueAdapter |

## Adapter Interfaces

The engine defines three adapter interfaces. Implement them for your infrastructure:

<<< @/snippets/guide/engine.ts#adapters

`StoreAdapter` persists workflow snapshots. `LockAdapter` prevents two processes from writing the same workflow simultaneously. `QueueAdapter` handles command and event message delivery.

## Creating an Engine

Pass your adapters and routers to `createEngine()`:

<<< @/snippets/guide/engine.ts#create-engine

The `routers` map keys are the names you'll use in `engine.create()` and `engine.execute()`. Each router's definition name must be unique.

If you omit `lock`, the engine uses an in-memory lock with a 30-second TTL. If you omit `queue`, events are still returned in the execution result but not enqueued anywhere.

## Creating Workflows

<<< @/snippets/guide/engine.ts#create-workflow

`create()` acquires a lock, saves the initial snapshot at version 0, and returns the snapshot with version 1. If a workflow with that ID already exists, it throws `WorkflowAlreadyExistsError`.

## Executing Commands

<<< @/snippets/guide/engine.ts#execute

`execute()` loads the workflow, acquires a lock, dispatches through the router, saves the new snapshot, and enqueues any emitted events. The `result` field is the same `DispatchResult` you get from `router.dispatch()`.

## Memory Adapters

For testing and prototyping, the engine ships with in-memory implementations:

<<< @/snippets/guide/engine.ts#memory-adapters

## Transactional Path

When the same object implements both `StoreAdapter` and `QueueAdapter` (plus `TransactionalAdapter`), the engine detects this and wraps save + enqueue in a transaction. If either fails, both roll back.

`memoryAdapter()` provides this — and your production adapters can too:

<<< @/snippets/guide/engine.ts#transactional

## HTTP Handler

`@rytejs/core/http` exports a standard `(Request) => Promise<Response>` handler that wraps the engine:

<<< @/snippets/guide/engine.ts#http-handler

Routes:
- `PUT /:router/:id` — Create a workflow
- `POST /:router/:id` — Execute a command
- `GET /:router/:id` — Load a workflow

Error mapping: `WorkflowNotFoundError` → 404, `LockConflictError` → 409, `ConcurrencyConflictError` → 409, `RestoreError` → 500.

## Error Handling

The engine throws specific errors for infrastructure-level problems (as opposed to domain errors, which are returned in the dispatch result):

<<< @/snippets/guide/engine.ts#error-handling

| Error | When | HTTP Status |
|-------|------|-------------|
| `WorkflowNotFoundError` | `execute()` — ID doesn't exist | 404 |
| `WorkflowAlreadyExistsError` | `create()` — ID already taken | 409 |
| `LockConflictError` | Lock held by another process | 409 |
| `ConcurrencyConflictError` | Version mismatch (stale read) | 409 |
| `RouterNotFoundError` | Router name not in engine | 500 |
| `RestoreError` | Stored snapshot fails Zod validation | 500 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/engine.ts docs/guide/engine.md
git commit -m "docs: add engine guide"
git push
```

---

## Task 3: Worker guide — snippets and page

**Files:**
- Create: `docs/snippets/guide/worker.ts`
- Create: `docs/guide/worker.md`

- [ ] **Step 1: Create `docs/snippets/guide/worker.ts`**

```ts
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { memoryAdapter } from "@rytejs/core/engine";
import {
	createWorker,
	defineWorkerPlugin,
	WorkerReactors,
} from "@rytejs/worker";
import type {
	BackoffConfig,
	CategoryPolicy,
	RetryPolicy,
	WorkerOptions,
} from "@rytejs/worker";
import { z } from "zod";

// ── Shared workflows for examples ────────────────────────────────────────────

const orderWorkflow = defineWorkflow("order", {
	states: {
		Placed: z.object({ item: z.string(), quantity: z.number() }),
		Paid: z.object({ item: z.string(), quantity: z.number() }),
		Shipped: z.object({ item: z.string(), trackingId: z.string() }),
	},
	commands: {
		Pay: z.object({}),
		Ship: z.object({ trackingId: z.string() }),
	},
	events: {
		OrderPaid: z.object({ orderId: z.string() }),
		OrderShipped: z.object({ orderId: z.string(), trackingId: z.string() }),
	},
	errors: {},
});

const orderRouter = new WorkflowRouter(orderWorkflow)
	.state("Placed", ({ on }) => {
		on("Pay", ({ data, transition, emit, workflow }) => {
			transition("Paid", { item: data.item, quantity: data.quantity });
			emit({ type: "OrderPaid", data: { orderId: workflow.id } });
		});
	})
	.state("Paid", ({ on }) => {
		on("Ship", ({ data, command, transition, emit, workflow }) => {
			transition("Shipped", {
				item: data.item,
				trackingId: command.payload.trackingId,
			});
			emit({
				type: "OrderShipped",
				data: {
					orderId: workflow.id,
					trackingId: command.payload.trackingId,
				},
			});
		});
	});

const shipmentWorkflow = defineWorkflow("shipment", {
	states: {
		Pending: z.object({}),
		Preparing: z.object({ orderId: z.string() }),
	},
	commands: {
		StartFulfillment: z.object({ orderId: z.string() }),
	},
	events: {},
	errors: {},
});

const shipmentRouter = new WorkflowRouter(shipmentWorkflow).state(
	"Pending",
	({ on }) => {
		on("StartFulfillment", ({ command, transition }) => {
			transition("Preparing", { orderId: command.payload.orderId });
		});
	},
);

// ── #create-worker ───────────────────────────────────────────────────────────

// #region create-worker
const adapter = memoryAdapter({ ttl: 30_000 });

const worker = createWorker({
	routers: [orderRouter, shipmentRouter],
	store: adapter,
	queue: adapter,
	lock: adapter,
	concurrency: 5,
	pollInterval: 1_000,
});
// #endregion create-worker

// ── #send ────────────────────────────────────────────────────────────────────

// #region send
await worker.send(orderRouter, "order-1", {
	type: "Pay",
	payload: {},
});
// #endregion send

// ── #lifecycle ───────────────────────────────────────────────────────────────

// #region lifecycle
await worker.start();

// ... application runs ...

// Graceful shutdown — waits for in-flight messages
await worker.stop();
// #endregion lifecycle

// ── #retry-policy ────────────────────────────────────────────────────────────

// #region retry-policy
const retryWorker = createWorker({
	routers: [orderRouter],
	store: adapter,
	queue: adapter,
	retryPolicy: {
		// Dependency errors (e.g., database down): retry with exponential backoff
		dependency: {
			action: "retry",
			maxRetries: 5,
			backoff: { strategy: "exponential", base: 1_000, max: 30_000 },
		},
		// Unexpected errors (handler threw): send to dead letter queue
		unexpected: { action: "dead-letter" },
		// Domain errors (business rule violations): dead letter for investigation
		domain: { action: "dead-letter" },
		// Validation errors (bad payload): drop — retrying won't help
		validation: { action: "drop" },
		// Router errors (no handler): drop — the code is wrong, not the message
		router: { action: "drop" },
	},
});
// #endregion retry-policy

// ── #backoff ─────────────────────────────────────────────────────────────────

// #region backoff
// Full config objects:
const exponential: BackoffConfig = {
	strategy: "exponential",
	base: 1_000,
	max: 30_000,
};
const fixed: BackoffConfig = { strategy: "fixed", delay: 5_000 };
const linear: BackoffConfig = {
	strategy: "linear",
	delay: 1_000,
	max: 10_000,
};

// Or use shorthands with sensible defaults:
const shorthand: CategoryPolicy = {
	action: "retry",
	maxRetries: 3,
	backoff: "exponential", // same as { strategy: "exponential", base: 1000, max: 30000 }
};
// #endregion backoff

// ── #reactors ────────────────────────────────────────────────────────────────

// #region reactors
// When an order is paid, start fulfillment in the shipment workflow
worker.react(orderRouter, "OrderPaid", ({ event, workflowId }) => ({
	workflowId: `shipment-${workflowId}`,
	router: shipmentRouter,
	command: {
		type: "StartFulfillment",
		payload: { orderId: workflowId },
	},
}));
// #endregion reactors

// ── #reactor-null ────────────────────────────────────────────────────────────

// #region reactor-null
// Return null to skip, or an array for multiple commands
worker.react(orderRouter, "OrderShipped", ({ event }) => {
	// Only notify for tracked shipments
	if (!event.data.trackingId) return null;

	return {
		workflowId: `notification-${event.data.orderId}`,
		router: orderRouter, // or any other router
		command: { type: "Pay", payload: {} },
	};
});
// #endregion reactor-null

// ── #hooks ───────────────────────────────────────────────────────────────────

// #region hooks
worker.on("command:started", ({ workflowId, message }) => {
	console.log(`Processing ${message.type} for ${workflowId}`);
});

worker.on("command:completed", ({ workflowId }) => {
	console.log(`Completed ${workflowId}`);
});

worker.on("command:failed", ({ workflowId, error, action }) => {
	console.error(`Failed ${workflowId}:`, error, `→ ${action}`);
});

worker.on("command:retried", ({ workflowId, attempt, maxRetries, delay }) => {
	console.log(
		`Retrying ${workflowId} (${attempt + 1}/${maxRetries}) in ${delay}ms`,
	);
});

worker.on("command:dead-lettered", ({ workflowId, reason }) => {
	console.error(`Dead-lettered ${workflowId}: ${reason}`);
});

worker.on("worker:started", () => console.log("Worker started"));
worker.on("worker:stopped", () => console.log("Worker stopped"));
// #endregion hooks

// ── #plugin ──────────────────────────────────────────────────────────────────

// #region plugin
const metricsPlugin = defineWorkerPlugin((hooks) => {
	hooks.on("command:completed", ({ message }) => {
		console.log(`metric: ${message.routerName}.${message.type}.success`);
	});
	hooks.on("command:failed", ({ message, action }) => {
		console.log(
			`metric: ${message.routerName}.${message.type}.${action}`,
		);
	});
});

worker.use(metricsPlugin);
// #endregion plugin

void retryWorker;
void exponential;
void fixed;
void linear;
void shorthand;
```

- [ ] **Step 2: Run snippet typecheck**

Run: `cd packages/core && pnpm tsup && cd ../worker && pnpm tsup && cd ../../docs && pnpm typecheck`
Expected: PASS (or fix type errors)

- [ ] **Step 3: Create `docs/guide/worker.md`**

```markdown
# Worker

`@rytejs/worker` is a background processing runtime that polls a queue, dispatches commands through the [engine](/guide/engine), handles retries, and routes events between workflows.

## When to Use a Worker

| Scenario | Use |
|----------|-----|
| HTTP request → dispatch → respond | Engine directly (`engine.execute()`) |
| Background job, async processing | Worker (`worker.send()`) |
| Cross-workflow event reactions | Worker with reactors |
| Retry with backoff on failure | Worker with retry policies |

## Installation

```bash
pnpm add @rytejs/worker
```

`@rytejs/worker` is a peer dependency of `@rytejs/core`.

## Creating a Worker

<<< @/snippets/guide/worker.ts#create-worker

The worker creates an engine internally from the routers, store, queue, and lock you provide. Each router's definition name must be unique.

| Option | Default | Description |
|--------|---------|-------------|
| `routers` | required | Array of `WorkflowRouter` instances |
| `store` | required | `StoreAdapter` for workflow persistence |
| `queue` | required | `QueueAdapter` for message delivery |
| `lock` | in-memory (30s TTL) | `LockAdapter` for concurrency control |
| `concurrency` | 1 | Max messages processed in parallel |
| `pollInterval` | 1000ms | Time between poll cycles |
| `retryPolicy` | see below | Per-category error handling |
| `shutdownTimeout` | 30000ms | Max wait for in-flight messages on stop |

## Sending Commands

<<< @/snippets/guide/worker.ts#send

`send()` enqueues a message. The worker's poll loop picks it up, acquires a lock, dispatches through the engine, and acks the message on success.

## Start and Stop

<<< @/snippets/guide/worker.ts#lifecycle

`stop()` stops polling and waits for in-flight messages to finish (up to `shutdownTimeout`). Connect it to your process signal handlers for graceful shutdown.

## Retry Policies

Each of the five [error categories](/guide/error-handling) gets its own policy:

<<< @/snippets/guide/worker.ts#retry-policy

The defaults are: `dependency` → retry 3× with exponential backoff, `unexpected` → dead-letter, `domain` → dead-letter, `validation` → drop, `router` → drop.

### Backoff Strategies

<<< @/snippets/guide/worker.ts#backoff

| Strategy | Formula | Use case |
|----------|---------|----------|
| `fixed` | Always `delay` ms | Rate-limited APIs |
| `exponential` | `base × 2^attempt`, capped at `max` | Transient failures (default) |
| `linear` | `delay × attempt`, capped at `max` | Gradually increasing pressure |

## Reactors

Reactors turn events from one workflow into commands for another. When the engine emits events, they're enqueued. The worker processes them and resolves matching reactors.

<<< @/snippets/guide/worker.ts#reactors

Return a single command object, an array for multiple commands, or `null` to skip:

<<< @/snippets/guide/worker.ts#reactor-null

## Lifecycle Hooks

Observe what the worker is doing without affecting its behavior:

<<< @/snippets/guide/worker.ts#hooks

| Event | When |
|-------|------|
| `command:started` | Message dequeued, about to execute |
| `command:completed` | Dispatch succeeded, message acked |
| `command:failed` | Dispatch failed (domain, validation, dependency, etc.) |
| `command:retried` | Message nacked with delay for retry |
| `command:dead-lettered` | Message moved to dead letter queue |
| `command:dropped` | Message acked without processing (validation/router errors) |
| `worker:started` | `worker.start()` called |
| `worker:stopped` | `worker.stop()` completed |

Hook errors are isolated — a failing hook never affects message processing.

## Worker Plugins

Package reusable hook configurations as plugins:

<<< @/snippets/guide/worker.ts#plugin

Worker plugins are branded with `defineWorkerPlugin()` and applied with `worker.use()`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/worker.ts docs/guide/worker.md
git commit -m "docs: add worker guide"
git push
```

---

## Task 4: React guide — snippets and page

**Files:**
- Create: `docs/snippets/guide/react.ts`
- Create: `docs/guide/react.md`

- [ ] **Step 1: Create `docs/snippets/guide/react.ts`**

The React package uses JSX and React hooks. Since the docs `tsconfig.snippets.json` only compiles `.ts` files and doesn't have `jsx` enabled, we use `declare` statements to demonstrate the API without importing React.

```ts
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import type {
	UseWorkflowReturn,
	WorkflowStore,
	WorkflowStoreOptions,
} from "@rytejs/react";
import { createWorkflowContext, createWorkflowStore, useWorkflow } from "@rytejs/react";
import { z } from "zod";

// ── Shared workflow ──────────────────────────────────────────────────────────

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
	},
	events: {},
	errors: {},
});

const taskRouter = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Start", ({ data, command, transition }) => {
			transition("InProgress", {
				title: data.title,
				assignee: command.payload.assignee,
			});
		});
	})
	.state("InProgress", ({ on }) => {
		on("Complete", ({ data, transition }) => {
			transition("Done", {
				title: data.title,
				completedAt: new Date(),
			});
		});
	});

// ── #create-store ────────────────────────────────────────────────────────────

// #region create-store
const store = createWorkflowStore(taskRouter, {
	state: "Todo",
	data: { title: "Write docs" },
});

// Dispatch a command
const result = await store.dispatch("Start", { assignee: "alice" });

// Read current state
const snapshot = store.getSnapshot();
console.log(snapshot.workflow.state); // "InProgress"
console.log(snapshot.isDispatching); // false
console.log(snapshot.error); // null
// #endregion create-store

// ── #use-workflow-hook ───────────────────────────────────────────────────────

// #region use-workflow-hook
// In a React component:
// const wf = useWorkflow(store);
//
// wf.workflow   — the full Workflow object
// wf.state      — current state name (narrowed)
// wf.data       — current state data (typed to the state)
// wf.isDispatching — true while a dispatch is in flight
// wf.error      — last PipelineError, or null
//
// await wf.dispatch("Start", { assignee: "alice" });
// #endregion use-workflow-hook

// ── #match ───────────────────────────────────────────────────────────────────

// #region match
// Exhaustive match — must handle every state
declare const wf: UseWorkflowReturn<typeof taskWorkflow.config>;

const label: string = wf.match({
	Todo: (data) => `📋 ${data.title}`,
	InProgress: (data) => `🔄 ${data.title} (${data.assignee})`,
	Done: (data) => `✅ ${data.title}`,
});

// Partial match with fallback
const badge: string = wf.match(
	{
		InProgress: (data) => `Assigned to ${data.assignee}`,
	},
	(workflow) => workflow.state,
);
// #endregion match

// ── #selector ────────────────────────────────────────────────────────────────

// #region selector
// Selector mode — re-renders only when the selected value changes
// const title = useWorkflow(store, (w) => w.data.title);
//
// Custom equality function:
// const data = useWorkflow(store, (w) => w.data, shallowEqual);
// #endregion selector

// ── #context ─────────────────────────────────────────────────────────────────

// #region context
const TaskWorkflow = createWorkflowContext(taskWorkflow);

// In a parent component:
// <TaskWorkflow.Provider store={store}>
//   <TaskView />
// </TaskWorkflow.Provider>

// In a child component:
// const wf = TaskWorkflow.useWorkflow();
// const title = TaskWorkflow.useWorkflow((w) => w.data.title);
// #endregion context

// ── #persistence ─────────────────────────────────────────────────────────────

// #region persistence
declare const localStorage: Storage;

const persistedStore = createWorkflowStore(
	taskRouter,
	{ state: "Todo", data: { title: "Write docs" } },
	{
		persist: {
			key: "task-workflow",
			storage: localStorage,
		},
	},
);

// On creation, the store checks storage for an existing snapshot.
// If found, it restores the workflow from the snapshot.
// On every successful dispatch, it saves the new snapshot.
// #endregion persistence

void store;
void result;
void snapshot;
void label;
void badge;
void TaskWorkflow;
void persistedStore;
```

- [ ] **Step 2: Add `@rytejs/react` as docs devDependency**

In `docs/package.json`, add:
```json
"@rytejs/react": "workspace:^"
```

Then run: `cd packages/react && pnpm tsup && cd ../../ && pnpm install`

- [ ] **Step 3: Run snippet typecheck**

Run: `cd docs && pnpm typecheck`
Expected: PASS (or fix type errors). The React snippets use `declare` for hooks and JSX to avoid needing React types.

- [ ] **Step 4: Create `docs/guide/react.md`**

```markdown
# React

`@rytejs/react` provides React bindings for workflows — use them as reactive state stores with full type safety.

## Installation

```bash
pnpm add @rytejs/react
```

`@rytejs/react` is a peer dependency of `@rytejs/core`.

## Creating a Store

A `WorkflowStore` wraps a router and provides reactive state management:

<<< @/snippets/guide/react.ts#create-store

The store dispatches commands through the router, tracks `isDispatching` state, and notifies subscribers on every change.

## useWorkflow Hook

The `useWorkflow` hook connects a store to a React component:

<<< @/snippets/guide/react.ts#use-workflow-hook

The returned object re-renders your component whenever the workflow state changes.

## State Matching

The `match()` method provides type-safe state discrimination — like a `switch` on the current state, but exhaustive:

<<< @/snippets/guide/react.ts#match

Exhaustive match requires a handler for every state. Partial match requires a fallback function. Both are fully typed — each handler receives the correct `data` type for that state.

## Selector Mode

For performance, use selector mode to re-render only when a specific value changes:

<<< @/snippets/guide/react.ts#selector

This is useful in large component trees where only a small piece of the workflow data is needed.

## Context API

For deeply nested components, use `createWorkflowContext()` to avoid prop-drilling the store:

<<< @/snippets/guide/react.ts#context

The context provides the same `useWorkflow()` API — both full mode and selector mode.

## Persistence

Persist workflow state to `localStorage` or `sessionStorage`:

<<< @/snippets/guide/react.ts#persistence

The store automatically restores from storage on creation and saves after every successful dispatch. Invalid stored data is silently discarded, falling back to the initial state.

You can also provide a `migrations` pipeline in the persist options for schema evolution — see [Migrations](/guide/migrations).
```

- [ ] **Step 5: Commit**

```bash
git add docs/snippets/guide/react.ts docs/guide/react.md docs/package.json pnpm-lock.yaml
git commit -m "docs: add react guide"
git push
```

---

## Task 5: Update observability guide with @rytejs/otel

**Files:**
- Create: `docs/snippets/guide/observability-otel.ts`
- Modify: `docs/guide/observability.md`

- [ ] **Step 1: Create `docs/snippets/guide/observability-otel.ts`**

```ts
import { WorkflowRouter } from "@rytejs/core";
import { createOtelPlugin } from "@rytejs/otel";
import { taskWorkflow } from "../fixtures.js";

// #region install
const router = new WorkflowRouter(taskWorkflow);
router.use(createOtelPlugin());
// #endregion install

// #region custom
// import { trace, metrics } from "@opentelemetry/api";
declare const trace: { getTracer(name: string): unknown };
declare const metrics: { getMeter(name: string): unknown };

const customRouter = new WorkflowRouter(taskWorkflow);
customRouter.use(
	createOtelPlugin({
		// biome-ignore lint/suspicious/noExplicitAny: external OTel types
		tracer: trace.getTracer("my-service") as any,
		// biome-ignore lint/suspicious/noExplicitAny: external OTel types
		meter: metrics.getMeter("my-service") as any,
	}),
);
// #endregion custom

void router;
void customRouter;
```

- [ ] **Step 2: Run snippet typecheck**

Run: `cd docs && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Update `docs/guide/observability.md`**

Add a new section at the top, after the opening paragraph but before "Structured Logging":

```markdown
## @rytejs/otel

For production OpenTelemetry instrumentation, use the official plugin:

```bash
pnpm add @rytejs/otel
```

One line to instrument a router with tracing and metrics:

<<< @/snippets/guide/observability-otel.ts#install

This automatically creates spans per dispatch (`ryte.dispatch.{command}`), records transitions and events as span events, sets error status with full category/code attributes, and emits three metrics: `ryte.dispatch.count`, `ryte.dispatch.duration`, and `ryte.transition.count`.

By default it uses the global OpenTelemetry API. To use a specific tracer or meter:

<<< @/snippets/guide/observability-otel.ts#custom

The patterns below are still useful if you want custom observability without the `@rytejs/otel` dependency.
```

- [ ] **Step 4: Commit**

```bash
git add docs/snippets/guide/observability-otel.ts docs/guide/observability.md
git commit -m "docs: add @rytejs/otel section to observability guide"
git push
```

---

## Task 6: Update sidebar config and API index

**Files:**
- Modify: `docs/.vitepress/config.ts`
- Modify: `docs/api/index.md`

- [ ] **Step 1: Update sidebar in `docs/.vitepress/config.ts`**

Add a new "Packages" section after "Advanced" in the guide sidebar:

```ts
{
	text: "Packages",
	items: [
		{ text: "Engine", link: "/guide/engine" },
		{ text: "Worker", link: "/guide/worker" },
		{ text: "React", link: "/guide/react" },
	],
},
```

- [ ] **Step 2: Update `docs/api/index.md`**

```markdown
# rytejs

## Modules

- [core/src](core/src.md)
- [testing/src](testing/src.md)
- @rytejs/worker — see [Worker guide](/guide/worker)
- @rytejs/react — see [React guide](/guide/react)
- @rytejs/otel — see [Observability guide](/guide/observability)
```

- [ ] **Step 3: Commit**

```bash
git add docs/.vitepress/config.ts docs/api/index.md
git commit -m "docs: add engine, worker, react to sidebar and API index"
git push
```

---

## Task 7: Final verification

- [ ] **Step 1: Rebuild all package dists**

Run: `cd packages/core && pnpm tsup && cd ../worker && pnpm tsup && cd ../otel && pnpm tsup && cd ../react && pnpm tsup`

- [ ] **Step 2: Run docs snippet typecheck**

Run: `pnpm --filter @rytejs/docs typecheck`
Expected: PASS — all snippet files compile

- [ ] **Step 3: Run full workspace check**

Run: `pnpm -w run check`
Expected: PASS

- [ ] **Step 4: Run docs dev to verify rendering**

Run: `cd docs && pnpm dev`
Manual check: Open each new page (Engine, Worker, React) and verify snippets render correctly.

- [ ] **Step 5: Commit and push**

```bash
git push
```
