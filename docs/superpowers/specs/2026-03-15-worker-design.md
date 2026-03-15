# @rytejs/worker

## Problem

`@rytejs/core` is a single-dispatch engine: give it a workflow + command, get a result. There's no runtime loop that watches for work, loads workflows, dispatches, persists, and reacts to events. Every production user needs to build this themselves.

## Solution

`@rytejs/worker` is a persistent worker runtime that drives the dispatch loop. It dequeues commands from a queue, loads workflows from a store, dispatches via registered routers, persists results, and enqueues reactor commands from emitted events. It handles retries, dead-lettering, concurrency, and graceful shutdown.

## Design

### Worker loop

```
poll queue for up to N commands (concurrency limit)
  → for each command:
    acquire lock on workflowId (skip + nack with delay if held)
    load workflow from store
    find router by workflow.definitionName
    dispatch(workflow, command)
    if ok: save workflow + events + outbox atomically → drain outbox to queue → ack
    if error: apply retry policy → retry / dead-letter / drop → ack
    release lock
```

Commands for different workflow instances process in parallel (up to `concurrency`). Commands for the same workflow instance are serialized via locking.

### API

```ts
import { createWorker } from "@rytejs/worker";
import { memoryStore, memoryQueue } from "@rytejs/worker/memory";

const worker = createWorker({
	routers: [orderRouter, shipmentRouter, inventoryRouter],
	store: memoryStore(),
	queue: memoryQueue(),
	concurrency: 10,
	lockTtl: 30_000,
	pollInterval: 1_000,
	retryPolicy: {
		dependency: { action: "retry", maxRetries: 3, backoff: "exponential" },
		unexpected: { action: "dead-letter" },
		domain: { action: "dead-letter" },
		validation: { action: "drop" },
		router: { action: "drop" },
	},
});

worker.react(orderRouter, "OrderPaid", ({ event, workflow }) => ({
	workflowId: event.data.shipmentId,
	router: shipmentRouter,
	command: { type: "StartFulfillment", payload: { orderId: workflow.id } },
}));

worker.use(otelPlugin);

await worker.start();
await worker.stop();
```

### Adapter interfaces

#### StoreAdapter

```ts
interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(id: string, workflow: Workflow, events: EmittedEvent[], outbox: OutboxCommand[]): Promise<void>;
	acquireLock(id: string, ttl: number): Promise<boolean>;
	releaseLock(id: string): Promise<void>;
}
```

- `save()` takes workflow + events + outbox together so adapters that support transactions (e.g., Postgres) can persist all three atomically. The in-memory adapter does this trivially.
- `acquireLock` returns a boolean — if the lock is held, the worker skips that command and nacks it with a short delay. No blocking waits.
- `StoredWorkflow` wraps the workflow snapshot plus metadata (retry count, version for optimistic concurrency).

#### QueueAdapter

```ts
interface QueueAdapter {
	dequeue(count: number): Promise<QueuedCommand[]>;
	enqueue(command: EnqueuedCommand): Promise<void>;
	ack(commandId: string): Promise<void>;
	nack(commandId: string, delay?: number): Promise<void>;
	deadLetter(commandId: string, reason: string): Promise<void>;
}
```

- `QueuedCommand` is `{ id: string, workflowId: string, type: string, payload: unknown, attempt: number }`.
- `EnqueuedCommand` adds `routerName: string` so the worker knows which router to use.
- `nack` with a delay requeues the command for later processing (used for retry backoff and lock contention).

### Built-in adapters

`@rytejs/worker/memory` exports `memoryStore()` and `memoryQueue()` for prototyping and testing. Both are in-process, non-durable. The store supports transactional save (workflow + outbox atomically). The queue is a simple FIFO with delay support.

These are NOT for production. Production adapters (e.g., `@rytejs/persistence-postgres`, `@rytejs/queue-bull`) are separate packages.

### Retry policy

Configurable per error category. Defaults:

| Category | Action | Max retries | Backoff |
|---|---|---|---|
| `"dependency"` | retry | 3 | exponential (1s, 2s, 4s) |
| `"unexpected"` | dead-letter | 0 | — |
| `"domain"` | dead-letter | 0 | — |
| `"validation"` | drop | 0 | — |
| `"router"` | drop | 0 | — |

Rationale:
- **dependency** — infrastructure failures that may recover on retry.
- **unexpected** — ambiguous; dead-letter by default so a human can investigate. Users can opt into retries.
- **domain** — intentional business rejections. Retrying won't change the outcome.
- **validation / router** — bugs in the caller (bad payload, wrong command). Won't fix themselves.

Retry count is tracked on the `QueuedCommand` (the queue adapter increments `attempt` on nack). When `attempt > maxRetries`, the command is dead-lettered.

Backoff strategies: `"fixed"` (constant delay), `"exponential"` (delay doubles each attempt), `"linear"` (delay increases by a fixed amount).

### Reactors

Reactors map emitted events from one workflow to commands on another (or the same) workflow. Defined on the worker instance with full type inference from registered routers:

```ts
worker.react(orderRouter, "OrderPaid", ({ event, workflow }) => ({
	workflowId: event.data.shipmentId,
	router: shipmentRouter,
	command: { type: "StartFulfillment", payload: { orderId: workflow.id } },
}));
```

Type safety:
- Event name is autocompleted from the source router's workflow config.
- `event.data` is typed from the event's Zod schema.
- Target `router` constrains `command.type` and `command.payload` to that router's config.
- Callback receives `{ event, workflow }` as a destructured object, consistent with core's handler pattern.

The callback returns an `EnqueuedCommand` or `null` (to skip).

#### Transactional outbox

Reactor commands don't go directly to the queue. Instead:

1. During `save()`, reactor commands are written to an **outbox** alongside the workflow update (same transaction if the store supports it).
2. After `save()` succeeds, the worker drains the outbox into the queue.
3. If the drain fails (queue is down), the commands are already persisted. A background sweep retries draining unpublished outbox entries on next poll.

This ensures reactor commands are never lost even if the queue is temporarily unavailable.

### Plugin system

Same pattern as core — a function that receives the worker and configures it:

```ts
import { defineWorkerPlugin } from "@rytejs/worker";

const loggingPlugin = defineWorkerPlugin((worker) => {
	worker.on("command:started", ({ workflowId, command }) => {
		console.log(`Processing ${command.type} on ${workflowId}`);
	});
	worker.on("command:failed", ({ workflowId, error, action }) => {
		console.error(`Failed: ${error.category}, action: ${action}`);
	});
});

worker.use(loggingPlugin);
```

### Worker lifecycle hooks

| Hook | When | Parameters |
|---|---|---|
| `command:started` | Command dequeued, lock acquired, about to dispatch | `{ workflowId, command }` |
| `command:completed` | Dispatch succeeded, persisted, reactors enqueued | `{ workflowId, command, result }` |
| `command:failed` | Dispatch failed | `{ workflowId, command, error, action }` |
| `command:retried` | Command nacked for retry | `{ workflowId, command, attempt, maxRetries, delay }` |
| `command:dead-lettered` | Command moved to dead letter | `{ workflowId, command, error, reason }` |
| `worker:started` | Worker loop started | `{}` |
| `worker:stopped` | Worker loop stopped | `{}` |

`action` in `command:failed` is `"retry" | "dead-letter" | "drop"`.

Hook errors never affect the worker loop (same isolation as core hooks).

### Concurrency and locking

- `concurrency` controls how many commands process in parallel (default: 1).
- Each command acquires a lock on its `workflowId` before loading/dispatching. If the lock is held (another command for the same workflow is in-flight), the command is nacked with a short delay.
- `lockTtl` is a safety net — if a worker crashes mid-dispatch, the lock auto-expires so another worker (or the same one after restart) can pick up the command.
- Different workflow instances process fully in parallel. Same-instance commands are serialized.

### Graceful shutdown

`worker.stop()`:
1. Stops polling for new commands.
2. Waits for all in-flight commands to complete (with a configurable timeout).
3. Releases all held locks.
4. Resolves the returned promise.

### Multi-router support

The worker accepts multiple routers via `routers: [...]`. When processing a command, it matches the loaded workflow's `definitionName` to the router's definition name. If no router matches, the command is dead-lettered with reason `"no_router"`.

### Package exports

```ts
// @rytejs/worker
export { createWorker } from "./worker.js";
export { defineWorkerPlugin } from "./plugin.js";
export type { StoreAdapter, StoredWorkflow, QueueAdapter, QueuedCommand, EnqueuedCommand } from "./types.js";
export type { RetryPolicy, WorkerOptions, WorkerPlugin } from "./types.js";

// @rytejs/worker/memory
export { memoryStore } from "./memory-store.js";
export { memoryQueue } from "./memory-queue.js";
```

## Scope

### In scope

- `createWorker` factory and `Worker` class
- `StoreAdapter` and `QueueAdapter` interfaces
- In-memory store and queue adapters
- Retry policy with per-category configuration
- Typed reactors with transactional outbox
- Plugin system with lifecycle hooks
- Concurrency with per-workflow locking
- Graceful shutdown
- Multi-router support

### Out of scope

- Production store/queue adapters (separate packages)
- Saga orchestration (separate `@rytejs/saga` package, builds on worker)
- Workflow creation (application-level concern, not the worker's job)
- Cron/scheduled commands (could be a plugin later)
- Cluster coordination (multiple worker instances on the same queue is handled by the queue adapter, not the worker itself)
