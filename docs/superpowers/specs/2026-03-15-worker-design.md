# @rytejs/worker

## Problem

`@rytejs/core` is a single-dispatch engine: give it a workflow + command, get a result. There's no runtime loop that watches for work, loads workflows, dispatches, persists, and reacts to events. Every production user needs to build this themselves.

## Solution

`@rytejs/worker` is a persistent worker runtime that drives the dispatch loop. It dequeues commands from a queue, loads workflows from a store, dispatches via registered routers, persists results, and enqueues reactor commands from emitted events. It handles retries, dead-lettering, concurrency, and graceful shutdown.

## Prerequisites

**Core change required:** `WorkflowRouter` must expose a public `readonly definitionName: string` property. Currently `definition` is private. The worker needs this to match loaded workflows to routers.

## Design

### Worker loop

```
poll queue for up to N commands (concurrency limit)
  → for each command:
    acquire lock on workflowId (skip + nack with delay if held)
    load StoredWorkflow from store
    restore Workflow via definition.restore(snapshot)
      → if restore fails: dead-letter with "restore_failed", release lock
    find router by workflow.definitionName
      → if no router: dead-letter with "no_router", release lock
    dispatch(workflow, command)
    if ok:
      snapshot workflow
      run reactors on emitted events → collect outbox commands
      save snapshot + events + outbox atomically
      drain outbox to queue
      ack command
    if error: apply retry policy → retry / dead-letter / drop → ack
    release lock
```

When `store.load(id)` returns `null`: dead-letter with reason `"workflow_not_found"`.

Commands for different workflow instances process in parallel (up to `concurrency`). Commands for the same workflow instance are serialized via locking.

### API

```ts
import { createWorker } from "@rytejs/worker";
import { memoryStore, memoryQueue, memoryLock } from "@rytejs/worker/memory";

const worker = createWorker({
	routers: [orderRouter, shipmentRouter, inventoryRouter],
	store: memoryStore(),
	queue: memoryQueue(),
	lock: memoryLock(), // optional, falls back to store if store implements LockAdapter
	concurrency: 10,
	lockTtl: 30_000,
	pollInterval: 1_000,
	retryPolicy: {
		dependency: {
			action: "retry",
			maxRetries: 3,
			backoff: { strategy: "exponential", base: 1_000, max: 30_000 },
		},
		unexpected: { action: "dead-letter" },
		domain: { action: "dead-letter" },
		validation: { action: "drop" },
		router: { action: "drop" },
	},
});

// Typed reactors — can return one command, an array, or null
worker.react(orderRouter, "OrderPaid", ({ event, workflow }) => ({
	workflowId: event.data.shipmentId,
	router: shipmentRouter,
	command: { type: "StartFulfillment", payload: { orderId: workflow.id } },
}));

// Convenience: validate and enqueue a command
await worker.send(orderRouter, "order-123", {
	type: "Place",
	payload: { items: ["widget"] },
});

// Plugins
worker.use(otelPlugin);

// Lifecycle
await worker.start();
await worker.stop();
```

### Adapter interfaces

#### StoreAdapter

```ts
interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number; // optimistic concurrency — adapter increments on save, rejects on mismatch
}

interface EmittedEvent {
	type: string;
	data: unknown;
}

interface OutboxCommand {
	id: string;
	workflowId: string;
	routerName: string;
	type: string;
	payload: unknown;
	published: boolean;
}

interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(
		id: string,
		snapshot: WorkflowSnapshot,
		events: EmittedEvent[],
		outbox: OutboxCommand[],
	): Promise<void>;
	drainOutbox(): Promise<OutboxCommand[]>;
}
```

- `save()` takes `WorkflowSnapshot` (not `Workflow`). The worker calls `definition.snapshot()` before saving and `definition.restore()` after loading. Adapters have no dependency on core's `WorkflowDefinition`.
- `save()` takes snapshot + events + outbox together so adapters that support transactions (e.g., Postgres) can persist all three atomically. The adapter increments `version` and rejects if the version doesn't match (optimistic concurrency).
- `drainOutbox()` returns outbox entries where `published === false`. The worker enqueues them and marks them published. Called after each save and periodically (configurable via `outboxSweepInterval`, defaults to `pollInterval * 5`).

#### LockAdapter

```ts
interface LockAdapter {
	acquire(id: string, ttl: number): Promise<boolean>;
	release(id: string): Promise<void>;
}
```

Separated from `StoreAdapter` so teams can use different backends (e.g., Postgres for storage, Redis for locks). The worker constructor accepts an optional `lock` parameter. If not provided, the store is checked for `acquire`/`release` methods — if present, it doubles as the lock adapter.

`acquire` returns `false` if the lock is held. The worker nacks the command with a short delay. No blocking waits. `lockTtl` is a safety net — if a worker crashes, the lock auto-expires. For v1, there is no lock heartbeat/extension mechanism. Set `lockTtl` well above expected dispatch time. Lock heartbeat is a v2 concern.

#### QueueAdapter

```ts
interface QueuedCommand {
	id: string;
	workflowId: string;
	type: string;
	payload: unknown;
	attempt: number;
}

interface EnqueuedCommand {
	workflowId: string;
	routerName: string;
	type: string;
	payload: unknown;
}

interface QueueAdapter {
	dequeue(count: number): Promise<QueuedCommand[]>;
	enqueue(command: EnqueuedCommand): Promise<void>;
	ack(commandId: string): Promise<void>;
	nack(commandId: string, delay?: number): Promise<void>;
	deadLetter(commandId: string, reason: string): Promise<void>;
}
```

- `QueuedCommand` is what comes off the queue — has an `id` and `attempt` count.
- `EnqueuedCommand` is what goes onto the queue — has `routerName` so the worker can validate the target router exists before loading the workflow. For initial commands (sent via `worker.send()`), `routerName` is set from the router's `definitionName`. For reactor-produced commands, `routerName` is set from the target router passed in the reactor callback.
- The queue adapter increments `attempt` on `nack`. When `attempt > maxRetries`, the worker calls `deadLetter` instead of `nack`.

### Built-in adapters

`@rytejs/worker/memory` exports `memoryStore()`, `memoryQueue()`, and `memoryLock()` for prototyping and testing. All are in-process, non-durable. The store supports transactional save (snapshot + outbox atomically). The queue is a simple FIFO with delay support.

These are NOT for production. Production adapters (e.g., `@rytejs/persistence-postgres`, `@rytejs/queue-bull`) are separate packages.

### Retry policy

Configurable per error category. Defaults:

| Category | Action | Max retries | Backoff |
|---|---|---|---|
| `"dependency"` | retry | 3 | exponential (1s base, 30s max) |
| `"unexpected"` | dead-letter | 0 | — |
| `"domain"` | dead-letter | 0 | — |
| `"validation"` | drop | 0 | — |
| `"router"` | drop | 0 | — |

Rationale:
- **dependency** — infrastructure failures that may recover on retry.
- **unexpected** — ambiguous; dead-letter by default so a human can investigate. Users can opt into retries.
- **domain** — intentional business rejections. Retrying won't change the outcome.
- **validation / router** — bugs in the caller (bad payload, wrong command). Won't fix themselves.

Retry count is tracked on `QueuedCommand.attempt` (the queue adapter increments it on nack). When `attempt > maxRetries`, the command is dead-lettered.

Backoff configuration:

```ts
type BackoffConfig =
	| { strategy: "fixed"; delay: number }            // constant delay in ms
	| { strategy: "exponential"; base: number; max: number } // delay = base * 2^attempt, capped at max
	| { strategy: "linear"; delay: number; max: number }     // delay = delay * attempt, capped at max
```

Shorthand: `backoff: "exponential"` is equivalent to `{ strategy: "exponential", base: 1_000, max: 30_000 }`.

### Sending commands

The worker exposes `worker.send()` as a convenience for enqueuing commands with type safety:

```ts
// Typed: router constrains command type and payload
await worker.send(orderRouter, "order-123", {
	type: "Place",
	payload: { items: ["widget"] },
});
```

This validates the command against the router's schema and calls `queue.enqueue()` with the correct `routerName`. It is how applications put initial commands into the queue.

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

The callback returns `EnqueuedCommand | EnqueuedCommand[] | null`. Returning an array triggers multiple commands from a single event. Returning `null` skips.

#### Transactional outbox

Reactor commands don't go directly to the queue. Instead:

1. After a successful dispatch, the worker runs reactor callbacks and collects `OutboxCommand` entries.
2. During `save()`, outbox entries are written alongside the workflow snapshot (same transaction if the store supports it), with `published: false`.
3. After `save()` succeeds, the worker calls `drainOutbox()` to get unpublished entries, enqueues them, and marks them published.
4. If the drain fails (queue is down), the commands are already persisted. The periodic outbox sweep (every `outboxSweepInterval`) retries draining.

This ensures reactor commands are never lost even if the queue is temporarily unavailable. Deduplication is handled by the outbox `id` — the queue adapter should ignore duplicates if the same `id` is enqueued twice.

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

The `worker` parameter in `defineWorkerPlugin` is a `WorkerHookRegistry` interface (not the full `Worker` class) — it only exposes `.on()` for registering hooks. This keeps the plugin API narrow.

### Worker lifecycle hooks

| Hook | When | Parameters |
|---|---|---|
| `command:started` | Command dequeued, lock acquired, about to dispatch | `{ workflowId, command }` |
| `command:completed` | Dispatch succeeded, persisted, reactors enqueued | `{ workflowId, command, result }` |
| `command:failed` | Dispatch failed | `{ workflowId, command, error, action }` |
| `command:retried` | Command nacked for retry | `{ workflowId, command, attempt, maxRetries, delay }` |
| `command:dead-lettered` | Command moved to dead letter | `{ workflowId, command, error, reason }` |
| `command:dropped` | Command dropped (validation/router error) | `{ workflowId, command, error }` |
| `worker:started` | Worker loop started | `{}` |
| `worker:stopped` | Worker loop stopped | `{}` |

`action` in `command:failed` is `"retry" | "dead-letter" | "drop"`.

Hook errors never affect the worker loop (same isolation as core hooks).

### Concurrency and locking

- `concurrency` controls how many commands process in parallel (default: 1).
- Each command acquires a lock on its `workflowId` before loading/dispatching. If the lock is held (another command for the same workflow is in-flight), the command is nacked with a short delay.
- `lockTtl` is a safety net — if a worker crashes mid-dispatch, the lock auto-expires so another worker (or the same one after restart) can pick up the command. Set this well above your expected maximum dispatch duration.
- Different workflow instances process fully in parallel. Same-instance commands are serialized.

### Graceful shutdown

`worker.stop()`:
1. Stops polling for new commands.
2. Waits for all in-flight commands to complete (with a configurable timeout).
3. Releases all held locks.
4. Resolves the returned promise.

### Multi-router support

The worker accepts multiple routers via `routers: [...]`. When processing a command, it uses `EnqueuedCommand.routerName` to find the registered router. If no router matches, the command is dead-lettered with reason `"no_router"`. The worker validates on startup that all registered routers have unique definition names.

### Package exports

```ts
// @rytejs/worker
export { createWorker } from "./worker.js";
export { defineWorkerPlugin } from "./plugin.js";
export type {
	StoreAdapter,
	StoredWorkflow,
	LockAdapter,
	QueueAdapter,
	QueuedCommand,
	EnqueuedCommand,
	EmittedEvent,
	OutboxCommand,
} from "./types.js";
export type { RetryPolicy, BackoffConfig, WorkerOptions, WorkerPlugin } from "./types.js";

// @rytejs/worker/memory
export { memoryStore } from "./memory-store.js";
export { memoryQueue } from "./memory-queue.js";
export { memoryLock } from "./memory-lock.js";
```

## Scope

### In scope

- `createWorker` factory and `Worker` class
- `StoreAdapter`, `LockAdapter`, and `QueueAdapter` interfaces
- In-memory store, queue, and lock adapters
- Retry policy with per-category configuration and backoff config
- Typed reactors with transactional outbox and periodic sweep
- `worker.send()` for type-safe command enqueuing
- Plugin system with lifecycle hooks
- Concurrency with per-workflow locking
- Graceful shutdown
- Multi-router support
- Core prerequisite: public `definitionName` on `WorkflowRouter`

### Out of scope

- Production store/queue/lock adapters (separate packages)
- Saga orchestration (separate `@rytejs/saga` package, builds on worker)
- Workflow creation (application-level concern, not the worker's job)
- Cron/scheduled commands (could be a plugin later)
- Cluster coordination (multiple worker instances on the same queue is handled by the queue adapter, not the worker itself)
- Lock heartbeat / extension (v2)
