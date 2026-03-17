# Engine Refactor + @rytejs/worker

## Problem

`@rytejs/core/engine` currently couples snapshot persistence with event storage, uses a non-pluggable in-process lock, and has no queue concept. Meanwhile, every production user building a worker loop must reimplement load → restore → dispatch → snapshot → save with their own locking and event routing.

`@rytejs/worker` needs a pure engine to build on — one that defines clean adapter contracts and lets shells (HTTP handler, worker, future integrations) provide the runtime behavior.

## Solution

Two changes:

1. **Refactor `@rytejs/core/engine`** — split adapters into `StoreAdapter` (snapshots only), `QueueAdapter` (events go here), `LockAdapter` (pluggable concurrency), and `TransactionalAdapter` (optional atomicity). The engine orchestrates but owns no implementations.

2. **Build `@rytejs/worker`** as a thin shell — poll loop, retry policy, reactors, lifecycle hooks, graceful shutdown. The worker delegates dispatch to the engine and adds no new adapter interfaces.

## Prerequisites

**Core change required:** Add `hasCommand(type: string): boolean` and `hasEvent(type: string): boolean` methods to `WorkflowDefinition`. These parallel the existing `hasState()` method and are needed for message discrimination in the worker (determining whether a queued message is a command or event without try/catch on `getCommandSchema()`/`getEventSchema()` which throw on miss).

## Design

### Engine adapter interfaces

Four interfaces. All defined in `@rytejs/core/engine`.

#### StoreAdapter

Snapshots only. No events, no outbox.

```ts
interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
}

interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}
```

The adapter increments `version` on save and rejects if `expectedVersion` doesn't match (optimistic concurrency).

#### QueueAdapter

Events from dispatch go here. Full interface defined in the engine so adapters implement one contract — the engine uses `enqueue()`, the worker uses the full set.

```ts
interface EnqueueMessage {
	workflowId: string;
	routerName: string;
	type: string;
	payload: unknown;
}

interface QueueMessage extends EnqueueMessage {
	id: string;
	attempt: number;
}

interface QueueAdapter {
	enqueue(messages: EnqueueMessage[]): Promise<void>;
	dequeue(count: number): Promise<QueueMessage[]>;
	ack(id: string): Promise<void>;
	nack(id: string, delay?: number): Promise<void>;
	deadLetter(id: string, reason: string): Promise<void>;
}
```

`EnqueueMessage` is the input to `enqueue()` — callers provide the message content. `QueueMessage` is the output of `dequeue()` — the adapter assigns `id` and sets `attempt` to 0 on first enqueue, incrementing on each `nack`.

Messages carry both commands and events. The worker discriminates using `definition.hasCommand(message.type)` and `definition.hasEvent(message.type)` (see Prerequisites). No `kind` discriminator field needed — the schemas are the source of truth.

#### LockAdapter

Pluggable concurrency. TTL is an adapter configuration concern, not an engine concern.

```ts
interface LockAdapter {
	acquire(id: string): Promise<boolean>;
	release(id: string): Promise<void>;
}
```

`acquire` returns `false` if the lock is held. No blocking waits. TTL (safety net for crashes) is configured at adapter creation:

```ts
const lock = memoryLock({ ttl: 30_000 });
const lock = redisLock(redis, { ttl: 30_000 });
```

#### TransactionalAdapter

Optional. Wraps store save + queue enqueue atomically when adapters share a backend.

```ts
interface TransactionalAdapter {
	transaction<T>(
		fn: (tx: { store: StoreAdapter; queue: QueueAdapter }) => Promise<T>,
	): Promise<T>;
}
```

The engine detects this capability at runtime:

```ts
function hasTransaction(obj: unknown): obj is TransactionalAdapter {
	return typeof obj === "object" && obj !== null && "transaction" in obj
		&& typeof (obj as any).transaction === "function";
}
```

The engine uses the transaction when the `store` object implements `TransactionalAdapter` **and** the store and queue are the same object (i.e., `store === queue`). This ensures the transaction provides coherent `{ store, queue }` references backed by the same connection. When store and queue are separate objects (e.g., Postgres store + SQS queue), the engine skips the transaction and calls save then enqueue sequentially (best-effort).

A Postgres adapter implements `StoreAdapter & QueueAdapter & LockAdapter & TransactionalAdapter` — one connection pool, one transaction for snapshot + events. A Redis-for-locks + Postgres-for-storage + SQS-for-queue setup implements them separately. The framework doesn't prescribe topology.

### Engine options and execute flow

```ts
interface EngineOptions {
	store: StoreAdapter;
	routers: Record<string, WorkflowRouter<any>>;
	lock?: LockAdapter;
	queue?: QueueAdapter;
}
```

`lock` defaults to `memoryLock()` — a non-blocking in-process lock matching the `LockAdapter` interface (returns `false` if held). This is a behavioral change from the current `withLock` which queues callers and blocks. `queue` defaults to no-op — events are only in the return value.

The engine also retains its `create()` method for creating new workflow instances. `create()` acquires a lock, validates no existing workflow, creates via `definition.createWorkflow()`, saves the snapshot, and returns. The HTTP handler uses `create()` directly.

Execute flow:

```
acquire lock via LockAdapter
  → if false: throw LockConflictError
  load StoredWorkflow from store
  restore via definition.restore()
  dispatch command via router
  if ok:
    snapshot workflow
    if store === queue and store implements TransactionalAdapter:
      transaction: save snapshot + enqueue events atomically
    else:
      save snapshot to store
      enqueue events to queue (if queue provided)
  release lock (in finally block — always runs)
  return ExecutionResult (always includes events)
```

When `acquire()` returns `false`, the engine throws `LockConflictError`. The worker catches this and nacks the message with a short delay. The HTTP handler can catch it and return 409 or 503.

`ExecutionResult` always returns events regardless of whether a queue is configured — the HTTP handler uses these directly from the return value. `EmittedEvent` is a return type (part of `ExecutionResult`), not a storage type.

### Built-in memory adapters

`@rytejs/core/engine` ships memory implementations for store, queue, and lock adapters: `memoryStore()`, `memoryQueue()`, `memoryLock({ ttl })`. All in-process, non-durable, for testing and prototyping. Not for production.

For testing the transactional path, `memoryAdapter()` returns a single object implementing `StoreAdapter & QueueAdapter & LockAdapter & TransactionalAdapter`. Since `store === queue` is the same object, the engine uses the transaction path. The separate factories (`memoryStore()`, `memoryQueue()`, `memoryLock()`) are for cases where you don't need transactional guarantees.

### Worker: thin shell on engine

The worker creates an `ExecutionEngine` internally and delegates dispatch to it. The worker adds:

1. **Poll loop** — dequeue messages, dispatch commands, resolve events
2. **Retry policy** — per-error-category retry/dead-letter/drop with backoff
3. **Reactors** — resolve events into commands, enqueue back
4. **Lifecycle hooks** — observe command processing
5. **Graceful shutdown** — drain in-flight, release locks

#### API

```ts
import { createWorker } from "@rytejs/worker";
import { memoryStore, memoryQueue, memoryLock } from "@rytejs/core/engine";

const worker = createWorker({
	routers: [orderRouter, shipmentRouter, inventoryRouter],
	store: memoryStore(),
	queue: memoryQueue(),
	lock: memoryLock({ ttl: 30_000 }),
	concurrency: 10,
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
```

#### Poll loop

```
dequeue up to N messages from queue (concurrency limit)
  for each message:
    find router by message.routerName
      → if no router: dead-letter with "no_router"
    discriminate message (command or event via router schemas)
    if command:
      engine.execute(routerName, workflowId, { type, payload })
      if ok: ack message
      if error: apply retry policy → nack with delay / dead-letter / drop, then ack
    if event:
      run reactors → produce commands → enqueue, then ack
```

Commands for different workflow instances process in parallel (up to `concurrency`). Commands for the same instance are serialized via the engine's lock.

#### Reactors

Map events to commands. Defined on the worker with type inference:

```ts
worker.react(orderRouter, "OrderPaid", ({ event, workflowId }) => ({
	workflowId: event.data.shipmentId,
	router: shipmentRouter,
	command: { type: "StartFulfillment", payload: { orderId: workflowId } },
}));
```

Type safety: event name autocompleted from source router, target router constrains command type and payload. Callback receives `{ event, workflowId }` — `event.data` is typed from the event's Zod schema, `workflowId` is the source workflow's ID. Callback returns command, array of commands, or null.

This supersedes the `@rytejs/core/reactor` API. The core reactor used `routerName: string`; the worker reactor uses `router: WorkflowRouter` for type inference on the target command.

Events land in the queue after dispatch (persisted atomically with the snapshot when `TransactionalAdapter` is available). Reactors process events in a subsequent poll iteration. This means reactor-produced commands are one poll cycle behind — acceptable trade-off for simpler architecture, and reactor failures don't affect the original dispatch.

This eliminates the transactional outbox concept from the original worker spec. Events in the queue serve the same purpose: if the worker crashes after dispatch, events are already in the queue and get redelivered.

#### Sending commands

```ts
await worker.send(orderRouter, "order-123", {
	type: "Place",
	payload: { items: ["widget"] },
});
```

Validates the command against the router's schema and calls `queue.enqueue()`. This is how applications put initial commands into the queue.

#### Retry policy

Per error category. Defaults:

| Category | Action | Max retries | Backoff |
|---|---|---|---|
| `dependency` | retry | 3 | exponential (1s base, 30s max) |
| `unexpected` | dead-letter | 0 | — |
| `domain` | dead-letter | 0 | — |
| `validation` | drop | 0 | — |
| `router` | drop | 0 | — |

Retry count tracked on `QueueMessage.attempt` (starts at 0, queue adapter increments on nack). When `attempt >= maxRetries`, the command is dead-lettered. With `maxRetries: 3`, the command executes up to 4 times: 1 initial attempt + 3 retries.

Backoff configuration:

```ts
type BackoffConfig =
	| { strategy: "fixed"; delay: number }
	| { strategy: "exponential"; base: number; max: number }
	| { strategy: "linear"; delay: number; max: number };
```

Shorthand: `backoff: "exponential"` is equivalent to `{ strategy: "exponential", base: 1_000, max: 30_000 }`.

Retry policy applies to commands only. Events that fail reactor resolution are nacked and retried with the same backoff, or dead-lettered after max retries.

#### Lifecycle hooks

| Hook | When | Parameters |
|---|---|---|
| `command:started` | Message dequeued, about to execute | `{ workflowId, message }` |
| `command:completed` | Dispatch succeeded, events enqueued | `{ workflowId, message, result }` |
| `command:failed` | Dispatch failed | `{ workflowId, message, error, action }` |
| `command:retried` | Message nacked for retry | `{ workflowId, message, attempt, maxRetries, delay }` |
| `command:dead-lettered` | Message moved to dead letter | `{ workflowId, message, error, reason }` |
| `command:dropped` | Message dropped | `{ workflowId, message, error }` |
| `worker:started` | Poll loop started | `{}` |
| `worker:stopped` | Poll loop stopped | `{}` |

`action` in `command:failed` is `"retry" | "dead-letter" | "drop"`.

Hook errors never affect the worker loop (same isolation as core hooks).

#### Plugin system

Same pattern as core:

```ts
import { defineWorkerPlugin } from "@rytejs/worker";

const loggingPlugin = defineWorkerPlugin((hooks) => {
	hooks.on("command:started", ({ workflowId, message }) => {
		console.log(`Processing ${message.type} on ${workflowId}`);
	});
	hooks.on("command:failed", ({ workflowId, error, action }) => {
		console.error(`Failed: ${error.category}, action: ${action}`);
	});
});

worker.use(loggingPlugin);
```

The `hooks` parameter is a `WorkerHookRegistry` interface — only exposes `.on()`. Keeps the plugin API narrow.

#### Concurrency and locking

- `concurrency` controls how many messages process in parallel (default: 1).
- Locking delegated to the engine via `LockAdapter`. Different workflow instances process in parallel. Same-instance commands serialize.
- The worker nacks a message with a short delay if the engine reports a lock failure.

#### Graceful shutdown

`worker.stop()`:
1. Stops polling for new messages.
2. Waits for all in-flight messages to complete (configurable timeout).
3. Resolves the returned promise.

Lock release is handled by the engine — each execute() releases its lock in a finally block.

#### Multi-router support

The worker accepts multiple routers via `routers: [...]` (an array). On startup, the worker converts this to a `Record<string, WorkflowRouter>` keyed by `router.definition.name`, validates all names are unique (throws on duplicates), and passes the record to the engine. Uses `QueueMessage.routerName` to find the correct router. Unknown router → dead-letter with `"no_router"`.

### Package exports

```ts
// @rytejs/core/engine
export { createEngine, ExecutionEngine } from "./engine.js";
export { memoryStore } from "./memory-store.js";
export { memoryQueue } from "./memory-queue.js";
export { memoryLock } from "./memory-lock.js";
export { memoryAdapter } from "./memory-adapter.js";
export {
	ConcurrencyConflictError,
	LockConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "./errors.js";
export type {
	StoreAdapter,
	StoredWorkflow,
	SaveOptions,
	QueueAdapter,
	QueueMessage,
	EnqueueMessage,
	LockAdapter,
	TransactionalAdapter,
	EngineOptions,
	ExecutionResult,
	EmittedEvent,
} from "./types.js";

// @rytejs/worker
export { createWorker } from "./worker.js";
export { defineWorkerPlugin } from "./plugin.js";
export type {
	RetryPolicy,
	BackoffConfig,
	WorkerOptions,
	WorkerPlugin,
} from "./types.js";
```

The worker defines no adapter interfaces. All adapters come from `@rytejs/core/engine`.

## Scope

### In scope

**Engine refactor:**
- `StoreAdapter` — snapshots only, drop events from `SaveOptions`
- `QueueAdapter` — full interface (enqueue/dequeue/ack/nack/deadLetter)
- `LockAdapter` — pluggable, replaces in-process `withLock`
- `TransactionalAdapter` — optional atomicity detection
- `LockConflictError` for failed lock acquisition
- Memory implementations: `memoryStore()`, `memoryQueue()`, `memoryLock()` (separate) and `memoryAdapter()` (combined, implements TransactionalAdapter)
- Add `hasCommand()` / `hasEvent()` to `WorkflowDefinition` (prerequisite)
- Update `ExecutionEngine` to use new adapters
- Update existing engine tests

**Worker package:**
- `createWorker` factory
- Poll loop with concurrency
- Retry policy with per-category configuration and backoff
- Typed reactors (events → commands)
- `worker.send()` for type-safe command enqueuing
- Plugin system with lifecycle hooks
- Graceful shutdown
- Multi-router support

### Out of scope

- Production adapters (Postgres, Redis, SQS — separate packages)
- Saga orchestration (separate `@rytejs/saga`, builds on worker)
- Workflow creation via worker (application-level concern)
- Cron/scheduled commands (plugin later)
- Cluster coordination (queue adapter's responsibility)
- Lock heartbeat/extension (v2)

## Supersedes

This spec supersedes `docs/superpowers/specs/2026-03-15-worker-design.md`. Key changes:
- `QueueAdapter` moved from worker to engine
- Events route to queue, not store — `EmittedEvent` removed from `SaveOptions`
- `StoreAdapter` is snapshots only
- `LockAdapter` added to engine with pluggable TTL, replaces blocking `withLock`
- `TransactionalAdapter` replaces transactional outbox pattern
- `OutboxCommand` type and `drainOutbox()` eliminated — events in the queue serve the same purpose
- `QueueMessage` carries both commands and events, discriminated by `definition.hasCommand()`/`hasEvent()`
- Separate `EnqueueMessage` (input) and `QueueMessage` (output) types — adapter assigns `id` and manages `attempt`
- Worker reactor API supersedes `@rytejs/core/reactor` — uses router reference for type inference instead of `routerName: string`
- Worker defines no adapter interfaces, imports all from engine
