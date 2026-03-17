# Engine Refactor + @rytejs/worker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the engine into pure adapter contracts (store, queue, lock, transaction) and build `@rytejs/worker` as a thin shell on top.

**Architecture:** The engine defines four adapter interfaces and orchestrates load → lock → dispatch → save → enqueue. The worker wraps the engine with a poll loop, retry policy, reactors, lifecycle hooks, and graceful shutdown. Memory adapters ship with the engine for testing.

**Tech Stack:** TypeScript, Zod v4, Vitest, tsup, pnpm workspaces

**Spec:** `docs/superpowers/specs/2026-03-17-engine-worker-design.md`

---

## File Structure

### Engine refactor (modify existing files in `packages/core/`)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/definition.ts` | Add `hasCommand()`, `hasEvent()` methods |
| Modify | `src/engine/types.ts` | New interfaces: `QueueAdapter`, `QueueMessage`, `EnqueueMessage`, `LockAdapter`, `TransactionalAdapter`. Remove `events` from `SaveOptions`. Add `lock?` and `queue?` to `EngineOptions` |
| Modify | `src/engine/errors.ts` | Add `LockConflictError` |
| Modify | `src/engine/engine.ts` | Use `LockAdapter`, `QueueAdapter`, `TransactionalAdapter`. Replace `withLock` calls |
| Modify | `src/engine/memory-store.ts` | Drop `events` from `save()` |
| Create | `src/engine/memory-queue.ts` | `memoryQueue()` — in-memory `QueueAdapter` |
| Create | `src/engine/memory-lock.ts` | `memoryLock({ ttl })` — in-memory `LockAdapter` |
| Create | `src/engine/memory-adapter.ts` | `memoryAdapter()` — combined store+queue+lock+transaction |
| Delete | `src/engine/lock.ts` | Replaced by `LockAdapter` interface + `memoryLock` |
| Modify | `src/engine/index.ts` | Export new types, adapters, errors |
| Modify | `src/http/handler.ts` | Handle `LockConflictError` → 409 |
| Modify | `__tests__/definition.test.ts` | Add `hasCommand`/`hasEvent` tests |
| Modify | `__tests__/engine/engine.test.ts` | Update for new adapter signatures |
| Modify | `__tests__/engine/memory-store.test.ts` | Remove `events` from save calls |
| Delete | `__tests__/engine/lock.test.ts` | Replaced by memory-lock tests |
| Create | `__tests__/engine/memory-queue.test.ts` | Tests for `memoryQueue()` |
| Create | `__tests__/engine/memory-lock.test.ts` | Tests for `memoryLock()` |
| Create | `__tests__/engine/memory-adapter.test.ts` | Tests for `memoryAdapter()` transactional behavior |
| Modify | `__tests__/http/handler.test.ts` | Add `LockConflictError` test |

### Worker package (new `packages/worker/`)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `package.json` | Package metadata, peer deps on `@rytejs/core` |
| Create | `tsconfig.json` | TypeScript config |
| Create | `tsup.config.ts` | Build config |
| Create | `src/types.ts` | `WorkerOptions`, `RetryPolicy`, `BackoffConfig`, `WorkerPlugin`, hook event types |
| Create | `src/backoff.ts` | `calculateDelay(config, attempt)` — pure function |
| Create | `src/hooks.ts` | `WorkerHookRegistry` — event emitter for worker lifecycle |
| Create | `src/plugin.ts` | `defineWorkerPlugin()` |
| Create | `src/reactors.ts` | Worker-level reactor registration and resolution |
| Create | `src/worker.ts` | `Worker` class — poll loop, message processing, send, start/stop |
| Create | `src/index.ts` | Public exports |
| Create | `__tests__/backoff.test.ts` | Backoff calculation tests |
| Create | `__tests__/hooks.test.ts` | Hook registry tests |
| Create | `__tests__/reactors.test.ts` | Reactor resolution tests |
| Create | `__tests__/worker.test.ts` | Full worker integration tests |

---

## Part 1: Engine Refactor

### Task 1: Add `hasCommand()` and `hasEvent()` to WorkflowDefinition

**Files:**
- Modify: `packages/core/src/definition.ts:16-82` (interface) and `packages/core/src/definition.ts:109-226` (implementation)
- Test: `packages/core/__tests__/definition.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/core/__tests__/definition.test.ts`, after the `hasState` test (line 85):

```ts
test("hasCommand returns true for known commands", () => {
	expect(testDefinition.hasCommand("Create")).toBe(true);
	expect(testDefinition.hasCommand("Publish")).toBe(true);
	expect(testDefinition.hasCommand("nonexistent")).toBe(false);
});

test("hasEvent returns true for known events", () => {
	expect(testDefinition.hasEvent("Created")).toBe(true);
	expect(testDefinition.hasEvent("nonexistent")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/definition.test.ts`
Expected: FAIL — `hasCommand is not a function`

- [ ] **Step 3: Add interface declarations**

In `packages/core/src/definition.ts`, add after `hasState` (line 65):

```ts
/**
 * Returns `true` if the given command name exists in the config.
 */
hasCommand(commandName: string): boolean;
/**
 * Returns `true` if the given event name exists in the config.
 */
hasEvent(eventName: string): boolean;
```

- [ ] **Step 4: Add implementations**

In `packages/core/src/definition.ts`, add after `hasState` implementation (line 161):

```ts
hasCommand(commandName: string): boolean {
	return commandName in config.commands;
},

hasEvent(eventName: string): boolean {
	return eventName in config.events;
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/definition.test.ts`
Expected: PASS

- [ ] **Step 6: Commit and push**

```bash
git add packages/core/src/definition.ts packages/core/__tests__/definition.test.ts
git commit -m "feat(core): add hasCommand() and hasEvent() to WorkflowDefinition"
git push
```

---

### Task 2: Refactor engine types — new adapter interfaces

**Files:**
- Modify: `packages/core/src/engine/types.ts`
- Modify: `packages/core/src/engine/errors.ts`

- [ ] **Step 1: Rewrite `packages/core/src/engine/types.ts`**

Replace the entire file. Key changes:
- Remove `events` from `SaveOptions`
- Remove `EmittedEvent` (move concept — events are now return-only via `ExecutionResult`)
- Add `QueueAdapter`, `QueueMessage`, `EnqueueMessage`, `LockAdapter`, `TransactionalAdapter`
- Add `lock?` and `queue?` to `EngineOptions`, remove `lockTimeout`

```ts
import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { DispatchResult, WorkflowConfig } from "../types.js";

export interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
}

export interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}

export interface EnqueueMessage {
	workflowId: string;
	routerName: string;
	type: string;
	payload: unknown;
}

export interface QueueMessage extends EnqueueMessage {
	id: string;
	attempt: number;
}

export interface QueueAdapter {
	enqueue(messages: EnqueueMessage[]): Promise<void>;
	dequeue(count: number): Promise<QueueMessage[]>;
	ack(id: string): Promise<void>;
	nack(id: string, delay?: number): Promise<void>;
	deadLetter(id: string, reason: string): Promise<void>;
}

export interface LockAdapter {
	acquire(id: string): Promise<boolean>;
	release(id: string): Promise<void>;
}

export interface TransactionalAdapter {
	transaction<T>(
		fn: (tx: { store: StoreAdapter; queue: QueueAdapter }) => Promise<T>,
	): Promise<T>;
}

export interface EmittedEvent {
	type: string;
	data: unknown;
}

export interface EngineOptions {
	store: StoreAdapter;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router map — each router has a different TConfig, type erasure is required
	routers: Record<string, WorkflowRouter<any>>;
	lock?: LockAdapter;
	queue?: QueueAdapter;
}

export interface ExecutionResult {
	result: DispatchResult<WorkflowConfig>;
	events: EmittedEvent[];
	version: number;
}
```

- [ ] **Step 2: Add `LockConflictError` to `packages/core/src/engine/errors.ts`**

Add after `RestoreError`:

```ts
export class LockConflictError extends Error {
	readonly name = "LockConflictError";

	constructor(readonly workflowId: string) {
		super(`Lock conflict for workflow "${workflowId}": lock is held by another process`);
	}
}
```

- [ ] **Step 3: Verify typecheck passes on types file**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: Errors in engine.ts and memory-store.ts (they still use old types) — that's expected, we fix them next.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine/types.ts packages/core/src/engine/errors.ts
git commit -m "feat(engine): add QueueAdapter, LockAdapter, TransactionalAdapter interfaces"
```

---

### Task 3: Implement `memoryLock()`

**Files:**
- Create: `packages/core/src/engine/memory-lock.ts`
- Create: `packages/core/__tests__/engine/memory-lock.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/engine/memory-lock.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { memoryLock } from "../../src/engine/memory-lock.js";

describe("memoryLock", () => {
	test("acquire returns true when lock is free", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		expect(await lock.acquire("wf-1")).toBe(true);
	});

	test("acquire returns false when lock is held", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await lock.acquire("wf-1");
		expect(await lock.acquire("wf-1")).toBe(false);
	});

	test("release makes lock available again", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await lock.acquire("wf-1");
		await lock.release("wf-1");
		expect(await lock.acquire("wf-1")).toBe(true);
	});

	test("different IDs are independent", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await lock.acquire("wf-1");
		expect(await lock.acquire("wf-2")).toBe(true);
	});

	test("lock auto-expires after TTL", async () => {
		vi.useFakeTimers();
		const lock = memoryLock({ ttl: 1_000 });
		await lock.acquire("wf-1");

		vi.advanceTimersByTime(1_001);
		expect(await lock.acquire("wf-1")).toBe(true);
		vi.useRealTimers();
	});

	test("release is a no-op for unheld locks", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await expect(lock.release("nonexistent")).resolves.toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-lock.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `memoryLock`**

Create `packages/core/src/engine/memory-lock.ts`:

```ts
import type { LockAdapter } from "./types.js";

export function memoryLock(options: { ttl: number }): LockAdapter {
	const locks = new Map<string, number>();

	return {
		async acquire(id: string): Promise<boolean> {
			const existing = locks.get(id);
			if (existing !== undefined && Date.now() < existing) {
				return false;
			}
			locks.set(id, Date.now() + options.ttl);
			return true;
		},

		async release(id: string): Promise<void> {
			locks.delete(id);
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-lock.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/core/src/engine/memory-lock.ts packages/core/__tests__/engine/memory-lock.test.ts
git commit -m "feat(engine): add memoryLock() adapter"
git push
```

---

### Task 4: Implement `memoryQueue()`

**Files:**
- Create: `packages/core/src/engine/memory-queue.ts`
- Create: `packages/core/__tests__/engine/memory-queue.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/engine/memory-queue.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { memoryQueue } from "../../src/engine/memory-queue.js";

describe("memoryQueue", () => {
	test("enqueue and dequeue round-trips messages", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "order", type: "Place", payload: { item: "x" } },
		]);

		const messages = await queue.dequeue(10);
		expect(messages).toHaveLength(1);
		expect(messages[0].workflowId).toBe("wf-1");
		expect(messages[0].routerName).toBe("order");
		expect(messages[0].type).toBe("Place");
		expect(messages[0].payload).toEqual({ item: "x" });
		expect(messages[0].attempt).toBe(0);
		expect(messages[0].id).toBeDefined();
	});

	test("dequeue returns empty array when queue is empty", async () => {
		const queue = memoryQueue();
		expect(await queue.dequeue(10)).toEqual([]);
	});

	test("dequeue respects count limit", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
			{ workflowId: "wf-2", routerName: "r", type: "B", payload: {} },
			{ workflowId: "wf-3", routerName: "r", type: "C", payload: {} },
		]);

		const messages = await queue.dequeue(2);
		expect(messages).toHaveLength(2);
	});

	test("ack removes message permanently", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
		]);

		const [msg] = await queue.dequeue(1);
		await queue.ack(msg.id);

		// Message should not reappear
		expect(await queue.dequeue(10)).toEqual([]);
	});

	test("nack re-enqueues message with incremented attempt", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
		]);

		const [msg] = await queue.dequeue(1);
		expect(msg.attempt).toBe(0);
		await queue.nack(msg.id);

		const [retried] = await queue.dequeue(1);
		expect(retried.attempt).toBe(1);
		expect(retried.workflowId).toBe("wf-1");
	});

	test("nack with delay hides message until delay expires", async () => {
		vi.useFakeTimers();
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
		]);

		const [msg] = await queue.dequeue(1);
		await queue.nack(msg.id, 1_000);

		// Not visible yet
		expect(await queue.dequeue(10)).toEqual([]);

		vi.advanceTimersByTime(1_001);
		const [retried] = await queue.dequeue(1);
		expect(retried.attempt).toBe(1);
		vi.useRealTimers();
	});

	test("deadLetter removes message from queue", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
		]);

		const [msg] = await queue.dequeue(1);
		await queue.deadLetter(msg.id, "test_reason");

		expect(await queue.dequeue(10)).toEqual([]);
	});

	test("dequeued messages are not visible to subsequent dequeue until ack/nack", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
		]);

		const first = await queue.dequeue(1);
		expect(first).toHaveLength(1);

		// Same message should not be dequeued again
		const second = await queue.dequeue(1);
		expect(second).toHaveLength(0);
	});

	test("enqueue multiple messages in one call", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
			{ workflowId: "wf-2", routerName: "r", type: "B", payload: {} },
		]);

		const messages = await queue.dequeue(10);
		expect(messages).toHaveLength(2);
		expect(messages[0].id).not.toBe(messages[1].id);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-queue.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `memoryQueue`**

Create `packages/core/src/engine/memory-queue.ts`:

```ts
import type { EnqueueMessage, QueueAdapter, QueueMessage } from "./types.js";

let nextId = 0;

export function memoryQueue(): QueueAdapter {
	const pending: QueueMessage[] = [];
	const inflight = new Map<string, QueueMessage>();
	const delayed: Array<{ message: QueueMessage; visibleAt: number }> = [];

	return {
		async enqueue(messages: EnqueueMessage[]): Promise<void> {
			for (const msg of messages) {
				pending.push({
					...msg,
					id: `msg-${++nextId}`,
					attempt: 0,
				});
			}
		},

		async dequeue(count: number): Promise<QueueMessage[]> {
			// Move delayed messages that are now visible
			const now = Date.now();
			const stillDelayed: typeof delayed = [];
			for (const entry of delayed) {
				if (now >= entry.visibleAt) {
					pending.push(entry.message);
				} else {
					stillDelayed.push(entry);
				}
			}
			delayed.length = 0;
			delayed.push(...stillDelayed);

			const messages = pending.splice(0, count);
			for (const msg of messages) {
				inflight.set(msg.id, msg);
			}
			return messages;
		},

		async ack(id: string): Promise<void> {
			inflight.delete(id);
		},

		async nack(id: string, delay?: number): Promise<void> {
			const msg = inflight.get(id);
			if (!msg) return;
			inflight.delete(id);
			const retried = { ...msg, attempt: msg.attempt + 1 };
			if (delay && delay > 0) {
				delayed.push({ message: retried, visibleAt: Date.now() + delay });
			} else {
				pending.push(retried);
			}
		},

		async deadLetter(id: string, _reason: string): Promise<void> {
			inflight.delete(id);
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/core/src/engine/memory-queue.ts packages/core/__tests__/engine/memory-queue.test.ts
git commit -m "feat(engine): add memoryQueue() adapter"
git push
```

---

### Task 5: Update `memoryStore()` — drop events from save

**Files:**
- Modify: `packages/core/src/engine/memory-store.ts`
- Modify: `packages/core/__tests__/engine/memory-store.test.ts`

- [ ] **Step 1: Update `memoryStore` implementation**

The `SaveOptions` type no longer has `events`, so the implementation already works — it only destructures `id`, `snapshot`, `expectedVersion`. But make sure the file compiles with the new types. No code change needed in `memory-store.ts` itself since it already ignores events.

- [ ] **Step 2: Update all test calls to remove `events` from save**

In `packages/core/__tests__/engine/memory-store.test.ts`, find and replace all instances of:
- `events: [],` — remove this property from every `store.save()` call

For example, change:
```ts
await store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 });
```
to:
```ts
await store.save({ id: "wf-1", snapshot, expectedVersion: 0 });
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-store.test.ts`
Expected: PASS

- [ ] **Step 4: Commit and push**

```bash
git add packages/core/src/engine/memory-store.ts packages/core/__tests__/engine/memory-store.test.ts
git commit -m "refactor(engine): remove events from SaveOptions and memoryStore"
git push
```

---

### Task 6: Implement `memoryAdapter()` — combined transactional adapter

**Files:**
- Create: `packages/core/src/engine/memory-adapter.ts`
- Create: `packages/core/__tests__/engine/memory-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/engine/memory-adapter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ConcurrencyConflictError } from "../../src/engine/errors.js";
import { memoryAdapter } from "../../src/engine/memory-adapter.js";
import type { TransactionalAdapter } from "../../src/engine/types.js";

const makeSnapshot = (id: string, state = "Draft") => ({
	id,
	definitionName: "test",
	state,
	data: { title: "hello" },
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	modelVersion: 1,
});

describe("memoryAdapter", () => {
	test("implements StoreAdapter: save and load", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const snapshot = makeSnapshot("wf-1");
		await adapter.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		const stored = await adapter.load("wf-1");
		expect(stored).not.toBeNull();
		expect(stored!.snapshot).toEqual(snapshot);
		expect(stored!.version).toBe(1);
	});

	test("implements QueueAdapter: enqueue and dequeue", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		await adapter.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
		]);

		const messages = await adapter.dequeue(10);
		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("A");
	});

	test("implements LockAdapter: acquire and release", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		expect(await adapter.acquire("wf-1")).toBe(true);
		expect(await adapter.acquire("wf-1")).toBe(false);
		await adapter.release("wf-1");
		expect(await adapter.acquire("wf-1")).toBe(true);
	});

	test("implements TransactionalAdapter: atomic save + enqueue", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const snapshot = makeSnapshot("wf-1");

		await (adapter as TransactionalAdapter).transaction(async (tx) => {
			await tx.store.save({ id: "wf-1", snapshot, expectedVersion: 0 });
			await tx.queue.enqueue([
				{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
			]);
		});

		const stored = await adapter.load("wf-1");
		expect(stored!.version).toBe(1);
		const messages = await adapter.dequeue(10);
		expect(messages).toHaveLength(1);
	});

	test("transaction rolls back both store and queue on error", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const snapshot = makeSnapshot("wf-1");

		// Pre-populate so we can verify rollback
		await adapter.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		await expect(
			(adapter as TransactionalAdapter).transaction(async (tx) => {
				await tx.store.save({
					id: "wf-1",
					snapshot: makeSnapshot("wf-1", "Published"),
					expectedVersion: 1,
				});
				await tx.queue.enqueue([
					{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
				]);
				throw new Error("Simulated failure");
			}),
		).rejects.toThrow("Simulated failure");

		// Store should not have the Published snapshot
		const stored = await adapter.load("wf-1");
		expect(stored!.snapshot.state).toBe("Draft");
		expect(stored!.version).toBe(1);

		// Queue should be empty
		expect(await adapter.dequeue(10)).toEqual([]);
	});

	test("store === queue identity check holds", () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		// This is the identity the engine checks for transactional support
		const store = adapter;
		const queue = adapter;
		expect(store === queue).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-adapter.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `memoryAdapter`**

Create `packages/core/src/engine/memory-adapter.ts`:

```ts
import { ConcurrencyConflictError } from "./errors.js";
import type {
	EnqueueMessage,
	LockAdapter,
	QueueAdapter,
	QueueMessage,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
	TransactionalAdapter,
} from "./types.js";

let nextId = 0;

export function memoryAdapter(options: {
	ttl: number;
}): StoreAdapter & QueueAdapter & LockAdapter & TransactionalAdapter {
	const store = new Map<string, StoredWorkflow>();
	const pending: QueueMessage[] = [];
	const inflight = new Map<string, QueueMessage>();
	const delayed: Array<{ message: QueueMessage; visibleAt: number }> = [];
	const locks = new Map<string, number>();

	const storeAdapter: StoreAdapter = {
		async load(id: string) {
			return store.get(id) ?? null;
		},
		async save(opts: SaveOptions) {
			const existing = store.get(opts.id);
			const currentVersion = existing?.version ?? 0;
			if (currentVersion !== opts.expectedVersion) {
				throw new ConcurrencyConflictError(opts.id, opts.expectedVersion, currentVersion);
			}
			store.set(opts.id, { snapshot: opts.snapshot, version: currentVersion + 1 });
		},
	};

	const queueAdapter: QueueAdapter = {
		async enqueue(messages: EnqueueMessage[]) {
			for (const msg of messages) {
				pending.push({ ...msg, id: `msg-${++nextId}`, attempt: 0 });
			}
		},
		async dequeue(count: number) {
			const now = Date.now();
			const stillDelayed: typeof delayed = [];
			for (const entry of delayed) {
				if (now >= entry.visibleAt) {
					pending.push(entry.message);
				} else {
					stillDelayed.push(entry);
				}
			}
			delayed.length = 0;
			delayed.push(...stillDelayed);

			const messages = pending.splice(0, count);
			for (const msg of messages) {
				inflight.set(msg.id, msg);
			}
			return messages;
		},
		async ack(id: string) {
			inflight.delete(id);
		},
		async nack(id: string, delay?: number) {
			const msg = inflight.get(id);
			if (!msg) return;
			inflight.delete(id);
			const retried = { ...msg, attempt: msg.attempt + 1 };
			if (delay && delay > 0) {
				delayed.push({ message: retried, visibleAt: Date.now() + delay });
			} else {
				pending.push(retried);
			}
		},
		async deadLetter(id: string, _reason: string) {
			inflight.delete(id);
		},
	};

	const lockAdapter: LockAdapter = {
		async acquire(id: string) {
			const existing = locks.get(id);
			if (existing !== undefined && Date.now() < existing) {
				return false;
			}
			locks.set(id, Date.now() + options.ttl);
			return true;
		},
		async release(id: string) {
			locks.delete(id);
		},
	};

	return {
		// StoreAdapter
		load: storeAdapter.load,
		save: storeAdapter.save,
		// QueueAdapter
		enqueue: queueAdapter.enqueue,
		dequeue: queueAdapter.dequeue,
		ack: queueAdapter.ack,
		nack: queueAdapter.nack,
		deadLetter: queueAdapter.deadLetter,
		// LockAdapter
		acquire: lockAdapter.acquire,
		release: lockAdapter.release,
		// TransactionalAdapter
		async transaction<T>(
			fn: (tx: { store: StoreAdapter; queue: QueueAdapter }) => Promise<T>,
		): Promise<T> {
			// Snapshot current state for rollback
			const storeBackup = new Map(store);
			const pendingBackup = [...pending];

			try {
				return await fn({ store: storeAdapter, queue: queueAdapter });
			} catch (err) {
				// Rollback
				store.clear();
				for (const [k, v] of storeBackup) store.set(k, v);
				pending.length = 0;
				pending.push(...pendingBackup);
				throw err;
			}
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/core/src/engine/memory-adapter.ts packages/core/__tests__/engine/memory-adapter.test.ts
git commit -m "feat(engine): add memoryAdapter() combined transactional adapter"
git push
```

---

### Task 7: Refactor `ExecutionEngine` — use new adapters

**Files:**
- Modify: `packages/core/src/engine/engine.ts`
- Delete: `packages/core/src/engine/lock.ts`

- [ ] **Step 1: Rewrite `packages/core/src/engine/engine.ts`**

Key changes:
- Import `LockAdapter`, `QueueAdapter`, `TransactionalAdapter` from types
- Import `memoryLock` for default lock
- Import `LockConflictError` from errors
- Remove `withLock` import
- Add `lock`, `queue` fields
- Add `hasTransaction()` helper
- `create()`: use `LockAdapter.acquire/release` instead of `withLock`, drop `events` from save
- `execute()`: use `LockAdapter`, use `TransactionalAdapter` when `store === queue`, enqueue events to queue

```ts
import type { WorkflowSnapshot } from "../snapshot.js";
import {
	ConcurrencyConflictError,
	LockConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "./errors.js";
import { memoryLock } from "./memory-lock.js";
import type {
	EmittedEvent,
	EngineOptions,
	ExecutionResult,
	LockAdapter,
	QueueAdapter,
	StoreAdapter,
	StoredWorkflow,
	TransactionalAdapter,
} from "./types.js";

function hasTransaction(obj: unknown): obj is TransactionalAdapter {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"transaction" in obj &&
		// biome-ignore lint/suspicious/noExplicitAny: runtime duck-type check for TransactionalAdapter capability
		typeof (obj as any).transaction === "function"
	);
}

export class ExecutionEngine {
	private readonly store: StoreAdapter;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router map — each router has a different TConfig
	private readonly routers: Record<string, import("../router.js").WorkflowRouter<any>>;
	private readonly lock: LockAdapter;
	private readonly queue: QueueAdapter | undefined;

	constructor(options: EngineOptions) {
		this.store = options.store;
		this.routers = options.routers;
		this.lock = options.lock ?? memoryLock({ ttl: 30_000 });
		this.queue = options.queue;
	}

	// biome-ignore lint/suspicious/noExplicitAny: returns type-erased router from heterogeneous map
	getRouter(name: string): import("../router.js").WorkflowRouter<any> {
		const router = this.routers[name];
		if (!router) throw new RouterNotFoundError(name);
		return router;
	}

	async load(id: string): Promise<StoredWorkflow | null> {
		return this.store.load(id);
	}

	async create(
		routerName: string,
		id: string,
		init: { initialState: string; data: unknown },
	): Promise<{ workflow: WorkflowSnapshot; version: number }> {
		const router = this.getRouter(routerName);
		const definition = router.definition;

		const acquired = await this.lock.acquire(id);
		if (!acquired) throw new LockConflictError(id);

		try {
			const existing = await this.store.load(id);
			if (existing) throw new WorkflowAlreadyExistsError(id);

			// as never: type erasure — the engine holds WorkflowConfig base type,
			// but createWorkflow validates data against Zod schemas at runtime
			const workflow = definition.createWorkflow(id, init as never);
			const snapshot = definition.snapshot(workflow);

			try {
				await this.store.save({
					id,
					snapshot,
					expectedVersion: 0,
				});
			} catch (err) {
				if (err instanceof ConcurrencyConflictError) {
					throw new WorkflowAlreadyExistsError(id);
				}
				throw err;
			}

			return { workflow: snapshot, version: 1 };
		} finally {
			await this.lock.release(id);
		}
	}

	async execute(
		routerName: string,
		id: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult> {
		const router = this.getRouter(routerName);
		const definition = router.definition;

		const acquired = await this.lock.acquire(id);
		if (!acquired) throw new LockConflictError(id);

		try {
			const stored = await this.store.load(id);
			if (!stored) throw new WorkflowNotFoundError(id);

			const restoreResult = definition.restore(stored.snapshot);
			if (!restoreResult.ok) {
				throw new RestoreError(id, restoreResult.error);
			}

			// as never: type erasure — the engine holds WorkflowConfig base type,
			// but dispatch validates commands against Zod schemas at runtime
			const result = await router.dispatch(restoreResult.workflow, command as never);

			if (!result.ok) {
				return { result, events: [], version: stored.version };
			}

			const newSnapshot = definition.snapshot(result.workflow);
			const events: EmittedEvent[] = (
				result.events as Array<{ type: string; data: unknown }>
			).map((e) => ({
				type: e.type,
				data: e.data,
			}));

			const enqueueMessages = events.map((e) => ({
				workflowId: id,
				routerName: definition.name,
				type: e.type,
				payload: e.data,
			}));

			if (
				this.queue &&
				this.store === this.queue &&
				hasTransaction(this.store)
			) {
				await this.store.transaction(async (tx) => {
					await tx.store.save({
						id,
						snapshot: newSnapshot,
						expectedVersion: stored.version,
					});
					if (enqueueMessages.length > 0) {
						await tx.queue.enqueue(enqueueMessages);
					}
				});
			} else {
				await this.store.save({
					id,
					snapshot: newSnapshot,
					expectedVersion: stored.version,
				});
				if (this.queue && enqueueMessages.length > 0) {
					await this.queue.enqueue(enqueueMessages);
				}
			}

			return { result, events, version: stored.version + 1 };
		} finally {
			await this.lock.release(id);
		}
	}
}

export function createEngine(options: EngineOptions): ExecutionEngine {
	return new ExecutionEngine(options);
}
```

- [ ] **Step 2: Delete old lock file**

Delete `packages/core/src/engine/lock.ts` — it's replaced by `memoryLock`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: May have errors in test files (they use old API) — that's fine, we fix those next.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine/engine.ts
git rm packages/core/src/engine/lock.ts
git commit -m "refactor(engine): use LockAdapter, QueueAdapter, TransactionalAdapter"
```

---

### Task 8: Update engine tests

**Files:**
- Modify: `packages/core/__tests__/engine/engine.test.ts`
- Delete: `packages/core/__tests__/engine/lock.test.ts`

- [ ] **Step 1: Update `engine.test.ts`**

Key changes throughout the file:
- Remove `lockTimeout` from engine options if used
- The `makeEngine` helper no longer needs `lockTimeout`
- Any tests that rely on the old blocking `withLock` behavior need updating — the new `LockAdapter` is non-blocking (returns `false` immediately)
- Add a test for `LockConflictError` when lock is held
- Remove `events: []` from any `store.save()` calls in mock stores

Add a new test:

```ts
test("execute throws LockConflictError when lock is held", async () => {
	const lock = memoryLock({ ttl: 30_000 });
	const engine = createEngine({ store: memoryStore(), routers: { task: taskRouter }, lock });

	await engine.create("task", "task-1", { initialState: "Todo", data: { title: "Test" } });

	// Acquire lock externally
	await lock.acquire("task-1");

	await expect(
		engine.execute("task", "task-1", { type: "Complete", payload: {} }),
	).rejects.toThrow(LockConflictError);

	// Release and verify it works now
	await lock.release("task-1");
	const result = await engine.execute("task", "task-1", { type: "Complete", payload: {} });
	expect(result.result.ok).toBe(true);
});
```

Also add import for `LockConflictError`, `memoryLock`, `memoryQueue`, and `memoryAdapter`.

Add tests for the transactional vs sequential path:

```ts
test("execute enqueues events to queue when queue is provided", async () => {
	const store = memoryStore();
	const queue = memoryQueue();
	const engine = createEngine({ store, routers: { task: taskRouter }, queue });

	await engine.create("task", "task-1", { initialState: "Todo", data: { title: "Test" } });
	const result = await engine.execute("task", "task-1", { type: "Complete", payload: {} });

	expect(result.result.ok).toBe(true);
	expect(result.events).toHaveLength(1);

	// Events should be in the queue
	const messages = await queue.dequeue(10);
	expect(messages).toHaveLength(1);
	expect(messages[0].type).toBe("TaskCompleted");
});

test("execute uses transactional path when store === queue", async () => {
	const adapter = memoryAdapter({ ttl: 30_000 });
	const engine = createEngine({ store: adapter, routers: { task: taskRouter }, queue: adapter, lock: adapter });

	await engine.create("task", "task-1", { initialState: "Todo", data: { title: "Test" } });
	const result = await engine.execute("task", "task-1", { type: "Complete", payload: {} });

	expect(result.result.ok).toBe(true);
	const messages = await adapter.dequeue(10);
	expect(messages).toHaveLength(1);
});
```

- [ ] **Step 2: Delete old lock tests**

Delete `packages/core/__tests__/engine/lock.test.ts`. The old `withLock` function is gone. `memoryLock` has its own tests in `memory-lock.test.ts`.

- [ ] **Step 3: Run all engine tests**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/`
Expected: PASS

- [ ] **Step 4: Commit and push**

```bash
git add packages/core/__tests__/engine/engine.test.ts
git rm packages/core/__tests__/engine/lock.test.ts
git commit -m "test(engine): update engine tests for new adapter interfaces"
git push
```

---

### Task 9: Update engine exports and HTTP handler

**Files:**
- Modify: `packages/core/src/engine/index.ts`
- Modify: `packages/core/src/http/handler.ts`
- Modify: `packages/core/__tests__/http/handler.test.ts`

- [ ] **Step 1: Update `packages/core/src/engine/index.ts`**

```ts
export { createEngine, ExecutionEngine } from "./engine.js";
export {
	ConcurrencyConflictError,
	LockConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "./errors.js";
export { memoryAdapter } from "./memory-adapter.js";
export { memoryLock } from "./memory-lock.js";
export { memoryQueue } from "./memory-queue.js";
export { memoryStore } from "./memory-store.js";
export type {
	EmittedEvent,
	EnqueueMessage,
	EngineOptions,
	ExecutionResult,
	LockAdapter,
	QueueAdapter,
	QueueMessage,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
	TransactionalAdapter,
} from "./types.js";
```

- [ ] **Step 2: Add `LockConflictError` handling to HTTP handler**

In `packages/core/src/http/handler.ts`, add import for `LockConflictError` and add a case in `mapEngineError`:

```ts
if (err instanceof LockConflictError) {
	return errorResponse(409, "conflict", err.message);
}
```

Add this after the `ConcurrencyConflictError` check.

- [ ] **Step 3: Add test for `LockConflictError` in HTTP handler**

In `packages/core/__tests__/http/handler.test.ts`, add a test that verifies the handler returns 409 when the engine throws `LockConflictError`. This will require injecting a lock that returns `false`.

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: PASS (all 149+ tests)

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm --filter @rytejs/core tsc --noEmit && pnpm biome check packages/core/`
Expected: PASS

- [ ] **Step 6: Commit and push**

```bash
git add packages/core/src/engine/index.ts packages/core/src/http/handler.ts packages/core/__tests__/http/handler.test.ts
git commit -m "feat(engine): update exports and HTTP handler for new adapter interfaces"
git push
```

---

### Task 10: Build dist and verify downstream packages

**Files:**
- None modified — verification only

**Note:** The `test` task in `turbo.json` has no `dependsOn: ["^build"]`, so worker tests won't automatically wait for core to build. Always rebuild core dist before running worker tests. This is an existing project constraint (same applies to `@rytejs/testing`).

- [ ] **Step 1: Rebuild core dist**

Run: `cd packages/core && pnpm tsup`
Expected: Builds successfully with all 4 entry points (index, engine, reactor, http)

- [ ] **Step 2: Run testing package tests**

Run: `pnpm --filter @rytejs/testing vitest run`
Expected: PASS (29 tests) — the testing package doesn't import engine types directly, but verify nothing broke.

- [ ] **Step 3: Run full workspace check**

Run: `pnpm run check`
Expected: PASS (typecheck + test + lint across all packages)

- [ ] **Step 4: Commit and push**

```bash
git push
```

---

## Part 2: @rytejs/worker Package

### Task 11: Scaffold `packages/worker` package

**Files:**
- Create: `packages/worker/package.json`
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/tsup.config.ts`

- [ ] **Step 1: Create `packages/worker/package.json`**

```json
{
	"name": "@rytejs/worker",
	"version": "0.1.0",
	"description": "Persistent worker runtime for @rytejs/core workflows",
	"license": "MIT",
	"type": "module",
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js",
			"require": "./dist/index.cjs"
		}
	},
	"main": "./dist/index.cjs",
	"module": "./dist/index.js",
	"types": "./dist/index.d.ts",
	"files": [
		"dist"
	],
	"sideEffects": false,
	"repository": {
		"type": "git",
		"url": "https://github.com/helico-tech/rytejs",
		"directory": "packages/worker"
	},
	"homepage": "https://helico-tech.github.io/rytejs",
	"bugs": "https://github.com/helico-tech/rytejs/issues",
	"keywords": [
		"workflow",
		"worker",
		"queue",
		"background-jobs"
	],
	"peerDependencies": {
		"@rytejs/core": "workspace:^"
	},
	"devDependencies": {
		"@rytejs/core": "workspace:*",
		"tsup": "^8.0.0",
		"typescript": "^5.7.0",
		"vitest": "^3.0.0",
		"zod": "^4.0.0"
	},
	"scripts": {
		"build": "tsup",
		"test": "vitest run",
		"test:watch": "vitest",
		"typecheck": "tsc --noEmit"
	},
	"engines": {
		"node": ">=18"
	}
}
```

- [ ] **Step 2: Create `packages/worker/tsconfig.json`**

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src"
	},
	"include": ["src"],
	"exclude": ["node_modules", "dist", "__tests__"]
}
```

- [ ] **Step 3: Create `packages/worker/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`
Expected: Installs dependencies, links workspace packages

- [ ] **Step 5: Commit and push**

```bash
git add packages/worker/package.json packages/worker/tsconfig.json packages/worker/tsup.config.ts pnpm-lock.yaml
git commit -m "feat(worker): scaffold @rytejs/worker package"
git push
```

---

### Task 12: Worker types — `RetryPolicy`, `BackoffConfig`, `WorkerOptions`

**Files:**
- Create: `packages/worker/src/types.ts`

- [ ] **Step 1: Create `packages/worker/src/types.ts`**

```ts
import type {
	EmittedEvent,
	EnqueueMessage,
	LockAdapter,
	QueueAdapter,
	QueueMessage,
	StoreAdapter,
} from "@rytejs/core/engine";
import type { WorkflowRouter } from "@rytejs/core";

export type BackoffConfig =
	| { strategy: "fixed"; delay: number }
	| { strategy: "exponential"; base: number; max: number }
	| { strategy: "linear"; delay: number; max: number };

export type BackoffShorthand = "exponential" | "fixed" | "linear";

export interface CategoryRetryPolicy {
	action: "retry";
	maxRetries: number;
	backoff: BackoffConfig | BackoffShorthand;
}

export interface CategoryDropPolicy {
	action: "drop";
}

export interface CategoryDeadLetterPolicy {
	action: "dead-letter";
}

export type CategoryPolicy = CategoryRetryPolicy | CategoryDropPolicy | CategoryDeadLetterPolicy;

export interface RetryPolicy {
	dependency: CategoryPolicy;
	unexpected: CategoryPolicy;
	domain: CategoryPolicy;
	validation: CategoryPolicy;
	router: CategoryPolicy;
}

export interface WorkerOptions {
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router array — each router has a different TConfig
	routers: WorkflowRouter<any>[];
	store: StoreAdapter;
	queue: QueueAdapter;
	lock?: LockAdapter;
	concurrency?: number;
	pollInterval?: number;
	retryPolicy?: Partial<RetryPolicy>;
	shutdownTimeout?: number;
}

export interface WorkerHookPayloads {
	"command:started": { workflowId: string; message: QueueMessage };
	"command:completed": { workflowId: string; message: QueueMessage; result: unknown };
	"command:failed": {
		workflowId: string;
		message: QueueMessage;
		error: unknown;
		action: "retry" | "dead-letter" | "drop";
	};
	"command:retried": {
		workflowId: string;
		message: QueueMessage;
		attempt: number;
		maxRetries: number;
		delay: number;
	};
	"command:dead-lettered": {
		workflowId: string;
		message: QueueMessage;
		error: unknown;
		reason: string;
	};
	"command:dropped": { workflowId: string; message: QueueMessage; error: unknown };
	"worker:started": Record<string, never>;
	"worker:stopped": Record<string, never>;
}

export type WorkerHookEvent = keyof WorkerHookPayloads;

export type WorkerPlugin = {
	(hooks: WorkerHookRegistry): void;
	readonly __brand: typeof WORKER_PLUGIN_BRAND;
};

declare const WORKER_PLUGIN_BRAND: unique symbol;

export interface WorkerHookRegistry {
	on<E extends WorkerHookEvent>(event: E, callback: (payload: WorkerHookPayloads[E]) => void): void;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/core && pnpm tsup && cd ../worker && pnpm tsc --noEmit`
Expected: May fail because `src/index.ts` doesn't exist yet — create a minimal one:

Create `packages/worker/src/index.ts`:
```ts
export type { BackoffConfig, RetryPolicy, WorkerOptions, WorkerPlugin } from "./types.js";
```

- [ ] **Step 3: Commit and push**

```bash
git add packages/worker/src/types.ts packages/worker/src/index.ts
git commit -m "feat(worker): add worker types"
git push
```

---

### Task 13: Backoff calculation

**Files:**
- Create: `packages/worker/src/backoff.ts`
- Create: `packages/worker/__tests__/backoff.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/worker/__tests__/backoff.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { calculateDelay, resolveBackoff } from "../src/backoff.js";

describe("resolveBackoff", () => {
	test("resolves 'exponential' shorthand", () => {
		expect(resolveBackoff("exponential")).toEqual({
			strategy: "exponential",
			base: 1_000,
			max: 30_000,
		});
	});

	test("passes through full config", () => {
		const config = { strategy: "fixed" as const, delay: 500 };
		expect(resolveBackoff(config)).toEqual(config);
	});
});

describe("calculateDelay", () => {
	test("fixed returns constant delay", () => {
		expect(calculateDelay({ strategy: "fixed", delay: 500 }, 0)).toBe(500);
		expect(calculateDelay({ strategy: "fixed", delay: 500 }, 3)).toBe(500);
	});

	test("exponential doubles each attempt, capped at max", () => {
		const config = { strategy: "exponential" as const, base: 1_000, max: 10_000 };
		expect(calculateDelay(config, 0)).toBe(1_000);
		expect(calculateDelay(config, 1)).toBe(2_000);
		expect(calculateDelay(config, 2)).toBe(4_000);
		expect(calculateDelay(config, 3)).toBe(8_000);
		expect(calculateDelay(config, 4)).toBe(10_000); // capped
	});

	test("linear multiplies by attempt, capped at max", () => {
		const config = { strategy: "linear" as const, delay: 1_000, max: 5_000 };
		expect(calculateDelay(config, 0)).toBe(0); // 1000 * 0
		expect(calculateDelay(config, 1)).toBe(1_000);
		expect(calculateDelay(config, 2)).toBe(2_000);
		expect(calculateDelay(config, 5)).toBe(5_000); // capped
		expect(calculateDelay(config, 10)).toBe(5_000); // still capped
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/backoff.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/worker/src/backoff.ts`:

```ts
import type { BackoffConfig, BackoffShorthand } from "./types.js";

const SHORTHAND_DEFAULTS: Record<BackoffShorthand, BackoffConfig> = {
	exponential: { strategy: "exponential", base: 1_000, max: 30_000 },
	fixed: { strategy: "fixed", delay: 1_000 },
	linear: { strategy: "linear", delay: 1_000, max: 30_000 },
};

export function resolveBackoff(config: BackoffConfig | BackoffShorthand): BackoffConfig {
	if (typeof config === "string") return SHORTHAND_DEFAULTS[config];
	return config;
}

export function calculateDelay(config: BackoffConfig, attempt: number): number {
	switch (config.strategy) {
		case "fixed":
			return config.delay;
		case "exponential":
			return Math.min(config.base * 2 ** attempt, config.max);
		case "linear":
			return Math.min(config.delay * attempt, config.max);
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/backoff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/worker/src/backoff.ts packages/worker/__tests__/backoff.test.ts
git commit -m "feat(worker): add backoff calculation"
git push
```

---

### Task 14: Worker hooks and plugin system

**Files:**
- Create: `packages/worker/src/hooks.ts`
- Create: `packages/worker/src/plugin.ts`
- Create: `packages/worker/__tests__/hooks.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/worker/__tests__/hooks.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { createWorkerHooks } from "../src/hooks.js";
import { defineWorkerPlugin, isWorkerPlugin } from "../src/plugin.js";

describe("WorkerHooks", () => {
	test("emits events to registered callbacks", () => {
		const hooks = createWorkerHooks();
		const cb = vi.fn();
		hooks.on("worker:started", cb);
		hooks.emit("worker:started", {});
		expect(cb).toHaveBeenCalledWith({});
	});

	test("supports multiple callbacks per event", () => {
		const hooks = createWorkerHooks();
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		hooks.on("command:started", cb1);
		hooks.on("command:started", cb2);
		const payload = { workflowId: "wf-1", message: {} as any };
		hooks.emit("command:started", payload);
		expect(cb1).toHaveBeenCalledWith(payload);
		expect(cb2).toHaveBeenCalledWith(payload);
	});

	test("callback errors are caught and do not propagate", () => {
		const hooks = createWorkerHooks();
		hooks.on("worker:started", () => {
			throw new Error("hook error");
		});
		expect(() => hooks.emit("worker:started", {})).not.toThrow();
	});
});

describe("defineWorkerPlugin", () => {
	test("creates a branded plugin function", () => {
		const plugin = defineWorkerPlugin((_hooks) => {});
		expect(isWorkerPlugin(plugin)).toBe(true);
	});

	test("plugin receives hook registry on apply", () => {
		const hooks = createWorkerHooks();
		const cb = vi.fn();
		const plugin = defineWorkerPlugin((h) => {
			h.on("worker:started", cb);
		});
		plugin(hooks);
		hooks.emit("worker:started", {});
		expect(cb).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/hooks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement hooks**

Create `packages/worker/src/hooks.ts`:

```ts
import type { WorkerHookEvent, WorkerHookPayloads, WorkerHookRegistry } from "./types.js";

export interface WorkerHooks extends WorkerHookRegistry {
	emit<E extends WorkerHookEvent>(event: E, payload: WorkerHookPayloads[E]): void;
}

export function createWorkerHooks(): WorkerHooks {
	const listeners = new Map<string, Array<(payload: unknown) => void>>();

	return {
		on<E extends WorkerHookEvent>(
			event: E,
			callback: (payload: WorkerHookPayloads[E]) => void,
		): void {
			const existing = listeners.get(event) ?? [];
			existing.push(callback as (payload: unknown) => void);
			listeners.set(event, existing);
		},

		emit<E extends WorkerHookEvent>(event: E, payload: WorkerHookPayloads[E]): void {
			const cbs = listeners.get(event);
			if (!cbs) return;
			for (const cb of cbs) {
				try {
					cb(payload);
				} catch {
					// Hook errors are isolated — never propagate
				}
			}
		},
	};
}
```

- [ ] **Step 4: Implement plugin**

Create `packages/worker/src/plugin.ts`:

```ts
import type { WorkerHookRegistry, WorkerPlugin } from "./types.js";

const WORKER_PLUGIN_BRAND = Symbol.for("@rytejs/worker/plugin");

export function defineWorkerPlugin(
	fn: (hooks: WorkerHookRegistry) => void,
): WorkerPlugin {
	const plugin = fn as WorkerPlugin;
	Object.defineProperty(plugin, "__brand", { value: WORKER_PLUGIN_BRAND });
	return plugin;
}

export function isWorkerPlugin(value: unknown): value is WorkerPlugin {
	return (
		typeof value === "function" &&
		"__brand" in value &&
		(value as WorkerPlugin).__brand === WORKER_PLUGIN_BRAND
	);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/hooks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit and push**

```bash
git add packages/worker/src/hooks.ts packages/worker/src/plugin.ts packages/worker/__tests__/hooks.test.ts
git commit -m "feat(worker): add hooks and plugin system"
git push
```

---

### Task 15: Worker reactors

**Files:**
- Create: `packages/worker/src/reactors.ts`
- Create: `packages/worker/__tests__/reactors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/worker/__tests__/reactors.test.ts`. This tests the reactor registration and resolution logic in isolation (no worker, no engine).

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { WorkerReactors } from "../src/reactors.js";

const orderWorkflow = defineWorkflow("order", {
	states: { Placed: z.object({ item: z.string() }), Paid: z.object({ item: z.string() }) },
	commands: { Pay: z.object({}) },
	events: { OrderPaid: z.object({ shipmentId: z.string() }) },
	errors: {},
});

const shipmentWorkflow = defineWorkflow("shipment", {
	states: { Pending: z.object({}), Preparing: z.object({ orderId: z.string() }) },
	commands: { StartFulfillment: z.object({ orderId: z.string() }) },
	events: {},
	errors: {},
});

const orderRouter = new WorkflowRouter(orderWorkflow);
const shipmentRouter = new WorkflowRouter(shipmentWorkflow);

describe("WorkerReactors", () => {
	test("resolves events into commands", () => {
		const reactors = new WorkerReactors();
		reactors.on(orderRouter, "OrderPaid", ({ event, workflowId }) => ({
			workflowId: event.data.shipmentId,
			router: shipmentRouter,
			command: { type: "StartFulfillment", payload: { orderId: workflowId } },
		}));

		const commands = reactors.resolve(
			orderRouter,
			"order-1",
			[{ type: "OrderPaid", data: { shipmentId: "ship-1" } }],
		);

		expect(commands).toHaveLength(1);
		expect(commands[0]).toEqual({
			workflowId: "ship-1",
			routerName: "shipment",
			type: "StartFulfillment",
			payload: { orderId: "order-1" },
		});
	});

	test("returns empty array when no reactors match", () => {
		const reactors = new WorkerReactors();
		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);
		expect(commands).toEqual([]);
	});

	test("handler returning null skips", () => {
		const reactors = new WorkerReactors();
		reactors.on(orderRouter, "OrderPaid", () => null);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);
		expect(commands).toEqual([]);
	});

	test("handler returning array produces multiple commands", () => {
		const reactors = new WorkerReactors();
		reactors.on(orderRouter, "OrderPaid", ({ event, workflowId }) => [
			{
				workflowId: event.data.shipmentId,
				router: shipmentRouter,
				command: { type: "StartFulfillment", payload: { orderId: workflowId } },
			},
		]);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);
		expect(commands).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm tsup && cd ../worker && pnpm vitest run __tests__/reactors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/worker/src/reactors.ts`:

```ts
import type { WorkflowRouter } from "@rytejs/core";
import type { EnqueueMessage } from "@rytejs/core/engine";

interface ReactorCommand {
	workflowId: string;
	// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic is inferred at registration, not at resolve time
	router: WorkflowRouter<any>;
	command: { type: string; payload: unknown };
}

type ReactorCallback = (ctx: {
	event: { type: string; data: unknown };
	workflowId: string;
}) => ReactorCommand | ReactorCommand[] | null;

interface ReactorEntry {
	definitionName: string;
	eventType: string;
	callback: ReactorCallback;
}

export class WorkerReactors {
	private readonly entries: ReactorEntry[] = [];

	on(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic differs per call
		router: WorkflowRouter<any>,
		eventType: string,
		callback: ReactorCallback,
	): this {
		this.entries.push({
			definitionName: router.definition.name,
			eventType,
			callback,
		});
		return this;
	}

	resolve(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic differs per call
		router: WorkflowRouter<any>,
		workflowId: string,
		events: Array<{ type: string; data: unknown }>,
	): EnqueueMessage[] {
		const results: EnqueueMessage[] = [];
		const defName = router.definition.name;

		for (const event of events) {
			for (const entry of this.entries) {
				if (entry.definitionName !== defName || entry.eventType !== event.type) continue;

				const result = entry.callback({ event, workflowId });
				if (!result) continue;

				const commands = Array.isArray(result) ? result : [result];
				for (const cmd of commands) {
					results.push({
						workflowId: cmd.workflowId,
						routerName: cmd.router.definition.name,
						type: cmd.command.type,
						payload: cmd.command.payload,
					});
				}
			}
		}

		return results;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/reactors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/worker/src/reactors.ts packages/worker/__tests__/reactors.test.ts
git commit -m "feat(worker): add reactor resolution"
git push
```

---

### Task 16: Worker class — poll loop, send, start/stop

**Files:**
- Create: `packages/worker/src/worker.ts`
- Create: `packages/worker/__tests__/worker.test.ts`

This is the largest task. The worker ties everything together: engine, queue, reactors, retry, hooks, graceful shutdown.

- [ ] **Step 1: Write failing tests**

Create `packages/worker/__tests__/worker.test.ts`:

```ts
import { describe, expect, test, vi, afterEach } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { memoryAdapter } from "@rytejs/core/engine";
import { createWorker } from "../src/worker.js";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Complete: z.object({}),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		AlreadyDone: z.object({}),
	},
});

const taskRouter = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", { title: data.title, completedAt: new Date() });
			emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
		});
	})
	.state("Done", ({ on }) => {
		on("Complete", ({ error }) => {
			error({ code: "AlreadyDone", data: {} });
		});
	});

function makeWorker(overrides?: Partial<Parameters<typeof createWorker>[0]>) {
	const adapter = memoryAdapter({ ttl: 30_000 });
	return {
		worker: createWorker({
			routers: [taskRouter],
			store: adapter,
			queue: adapter,
			lock: adapter,
			concurrency: 1,
			pollInterval: 50,
			...overrides,
		}),
		adapter,
	};
}

afterEach(async () => {
	// Tests create workers — ensure they're stopped
});

describe("createWorker", () => {
	test("throws if routers have duplicate definition names", () => {
		const adapter = memoryAdapter({ ttl: 30_000 });
		expect(() =>
			createWorker({
				routers: [taskRouter, taskRouter],
				store: adapter,
				queue: adapter,
			}),
		).toThrow("Duplicate router definition name");
	});
});

describe("worker.send()", () => {
	test("enqueues a command to the queue", async () => {
		const { worker, adapter } = makeWorker();
		await worker.send(taskRouter, "task-1", {
			type: "Complete",
			payload: {},
		});

		const messages = await adapter.dequeue(10);
		expect(messages).toHaveLength(1);
		expect(messages[0].workflowId).toBe("task-1");
		expect(messages[0].routerName).toBe("task");
		expect(messages[0].type).toBe("Complete");
	});
});

describe("worker poll loop", () => {
	test("processes a command from the queue", async () => {
		const { worker, adapter } = makeWorker();

		// Create workflow via engine directly
		await adapter.save({
			id: "task-1",
			snapshot: {
				id: "task-1",
				definitionName: "task",
				state: "Todo",
				data: { title: "Test" },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
			},
			expectedVersion: 0,
		});

		// Enqueue command
		await worker.send(taskRouter, "task-1", { type: "Complete", payload: {} });

		// Start and wait for processing
		await worker.start();
		await new Promise((r) => setTimeout(r, 200));
		await worker.stop();

		// Verify workflow transitioned
		const stored = await adapter.load("task-1");
		expect(stored!.snapshot.state).toBe("Done");
	});

	test("dead-letters commands for unknown routers", async () => {
		const { worker, adapter } = makeWorker();

		// Enqueue command for unknown router
		await adapter.enqueue([
			{ workflowId: "wf-1", routerName: "unknown", type: "Foo", payload: {} },
		]);

		await worker.start();
		await new Promise((r) => setTimeout(r, 200));
		await worker.stop();

		// Queue should be empty (dead-lettered)
		expect(await adapter.dequeue(10)).toEqual([]);
	});
});

describe("worker lifecycle hooks", () => {
	test("emits command:started and command:completed", async () => {
		const { worker, adapter } = makeWorker();
		const started = vi.fn();
		const completed = vi.fn();

		worker.on("command:started", started);
		worker.on("command:completed", completed);

		await adapter.save({
			id: "task-1",
			snapshot: {
				id: "task-1",
				definitionName: "task",
				state: "Todo",
				data: { title: "Test" },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
			},
			expectedVersion: 0,
		});

		await worker.send(taskRouter, "task-1", { type: "Complete", payload: {} });
		await worker.start();
		await new Promise((r) => setTimeout(r, 200));
		await worker.stop();

		expect(started).toHaveBeenCalledTimes(1);
		expect(completed).toHaveBeenCalledTimes(1);
	});
});

describe("worker.stop()", () => {
	test("stops polling and resolves", async () => {
		const { worker } = makeWorker();
		await worker.start();
		await worker.stop();
		// No error = success
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/worker.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the worker**

Create `packages/worker/src/worker.ts`:

```ts
import type { WorkflowRouter } from "@rytejs/core";
import {
	type EmittedEvent,
	type EnqueueMessage,
	type LockAdapter,
	LockConflictError,
	type QueueAdapter,
	type QueueMessage,
	type StoreAdapter,
	createEngine,
} from "@rytejs/core/engine";
import { calculateDelay, resolveBackoff } from "./backoff.js";
import { type WorkerHooks, createWorkerHooks } from "./hooks.js";
import { WorkerReactors } from "./reactors.js";
import type {
	RetryPolicy,
	WorkerHookEvent,
	WorkerHookPayloads,
	WorkerOptions,
	WorkerPlugin,
} from "./types.js";

const DEFAULT_RETRY_POLICY: RetryPolicy = {
	dependency: { action: "retry", maxRetries: 3, backoff: "exponential" },
	unexpected: { action: "dead-letter" },
	domain: { action: "dead-letter" },
	validation: { action: "drop" },
	router: { action: "drop" },
};

export class Worker {
	private readonly engine: ReturnType<typeof createEngine>;
	private readonly queue: QueueAdapter;
	private readonly reactors = new WorkerReactors();
	private readonly hooks: WorkerHooks;
	private readonly retryPolicy: RetryPolicy;
	private readonly concurrency: number;
	private readonly pollInterval: number;
	private readonly shutdownTimeout: number;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router map
	private readonly routerMap: Record<string, WorkflowRouter<any>>;
	private running = false;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private inflight = 0;

	constructor(options: WorkerOptions) {
		// Build router map from array, validate unique names
		this.routerMap = {};
		for (const router of options.routers) {
			const name = router.definition.name;
			if (this.routerMap[name]) {
				throw new Error(`Duplicate router definition name: "${name}"`);
			}
			this.routerMap[name] = router;
		}

		this.engine = createEngine({
			store: options.store,
			routers: this.routerMap,
			lock: options.lock,
			queue: options.queue,
		});

		this.queue = options.queue;
		this.hooks = createWorkerHooks();
		this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
		this.concurrency = options.concurrency ?? 1;
		this.pollInterval = options.pollInterval ?? 1_000;
		this.shutdownTimeout = options.shutdownTimeout ?? 30_000;
	}

	on<E extends WorkerHookEvent>(
		event: E,
		callback: (payload: WorkerHookPayloads[E]) => void,
	): void {
		this.hooks.on(event, callback);
	}

	use(plugin: WorkerPlugin): void {
		plugin(this.hooks);
	}

	react(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure for reactor registration
		router: WorkflowRouter<any>,
		eventType: string,
		callback: Parameters<WorkerReactors["on"]>[2],
	): this {
		this.reactors.on(router, eventType, callback);
		return this;
	}

	async send(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic is inferred at call site
		router: WorkflowRouter<any>,
		workflowId: string,
		command: { type: string; payload: unknown },
	): Promise<void> {
		// Validate command against router schema
		const schema = router.definition.getCommandSchema(command.type);
		schema.parse(command.payload);

		await this.queue.enqueue([
			{
				workflowId,
				routerName: router.definition.name,
				type: command.type,
				payload: command.payload,
			},
		]);
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.hooks.emit("worker:started", {});
		this.poll();
	}

	async stop(): Promise<void> {
		this.running = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		// Wait for in-flight messages with timeout
		if (this.inflight > 0) {
			await Promise.race([
				new Promise<void>((resolve) => {
					const check = () => {
						if (this.inflight <= 0) {
							resolve();
						} else {
							setTimeout(check, 50);
						}
					};
					setTimeout(check, 50);
				}),
				new Promise<void>((resolve) =>
					setTimeout(resolve, this.shutdownTimeout),
				),
			]);
		}

		this.hooks.emit("worker:stopped", {});
	}

	private poll(): void {
		if (!this.running) return;

		const available = this.concurrency - this.inflight;
		if (available <= 0) {
			this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
			return;
		}

		this.queue.dequeue(available).then((messages) => {
			for (const msg of messages) {
				this.inflight++;
				this.processMessage(msg).finally(() => {
					this.inflight--;
				});
			}

			if (this.running) {
				this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
			}
		});
	}

	private async processMessage(message: QueueMessage): Promise<void> {
		const router = this.routerMap[message.routerName];
		if (!router) {
			await this.queue.deadLetter(message.id, "no_router");
			this.hooks.emit("command:dead-lettered", {
				workflowId: message.workflowId,
				message,
				error: new Error(`No router for "${message.routerName}"`),
				reason: "no_router",
			});
			return;
		}

		const definition = router.definition;

		// Discriminate: command or event
		if (definition.hasCommand(message.type)) {
			await this.processCommand(message);
		} else if (definition.hasEvent(message.type)) {
			await this.processEvent(message, router);
		} else {
			await this.queue.deadLetter(message.id, "unknown_type");
			this.hooks.emit("command:dead-lettered", {
				workflowId: message.workflowId,
				message,
				error: new Error(`Unknown type "${message.type}" for router "${message.routerName}"`),
				reason: "unknown_type",
			});
		}
	}

	private async processCommand(message: QueueMessage): Promise<void> {
		this.hooks.emit("command:started", {
			workflowId: message.workflowId,
			message,
		});

		try {
			const execResult = await this.engine.execute(
				message.routerName,
				message.workflowId,
				{ type: message.type, payload: message.payload },
			);

			if (execResult.result.ok) {
				await this.queue.ack(message.id);
				this.hooks.emit("command:completed", {
					workflowId: message.workflowId,
					message,
					result: execResult,
				});
			} else {
				const error = execResult.result.error;
				await this.handleError(message, error.category, error);
			}
		} catch (err) {
			if (err instanceof LockConflictError) {
				// Nack with short delay — lock is held, will retry
				await this.queue.nack(message.id, 100);
				return;
			}
			await this.handleError(message, "unexpected", err);
		}
	}

	private async processEvent(
		message: QueueMessage,
		// biome-ignore lint/suspicious/noExplicitAny: type erasure for reactor resolution
		router: WorkflowRouter<any>,
	): Promise<void> {
		try {
			const commands = this.reactors.resolve(
				router,
				message.workflowId,
				[{ type: message.type, data: message.payload }],
			);

			if (commands.length > 0) {
				await this.queue.enqueue(commands);
			}

			await this.queue.ack(message.id);
		} catch {
			await this.queue.nack(message.id);
		}
	}

	private async handleError(
		message: QueueMessage,
		category: string,
		error: unknown,
	): Promise<void> {
		const policy = this.retryPolicy[category as keyof RetryPolicy] ?? {
			action: "dead-letter" as const,
		};

		const action = policy.action;

		this.hooks.emit("command:failed", {
			workflowId: message.workflowId,
			message,
			error,
			action,
		});

		if (action === "retry") {
			const retryPolicy = policy as { maxRetries: number; backoff: unknown };
			if (message.attempt >= retryPolicy.maxRetries) {
				await this.queue.deadLetter(message.id, category);
				this.hooks.emit("command:dead-lettered", {
					workflowId: message.workflowId,
					message,
					error,
					reason: category,
				});
			} else {
				const backoff = resolveBackoff(retryPolicy.backoff as Parameters<typeof resolveBackoff>[0]);
				const delay = calculateDelay(backoff, message.attempt);
				await this.queue.nack(message.id, delay);
				this.hooks.emit("command:retried", {
					workflowId: message.workflowId,
					message,
					attempt: message.attempt,
					maxRetries: retryPolicy.maxRetries,
					delay,
				});
			}
		} else if (action === "dead-letter") {
			await this.queue.deadLetter(message.id, category);
			this.hooks.emit("command:dead-lettered", {
				workflowId: message.workflowId,
				message,
				error,
				reason: category,
			});
		} else {
			// drop
			await this.queue.ack(message.id);
			this.hooks.emit("command:dropped", {
				workflowId: message.workflowId,
				message,
				error,
			});
		}
	}
}

export function createWorker(options: WorkerOptions): Worker {
	return new Worker(options);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/worker vitest run __tests__/worker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add packages/worker/src/worker.ts packages/worker/__tests__/worker.test.ts
git commit -m "feat(worker): implement Worker class with poll loop, retry, hooks"
git push
```

---

### Task 17: Worker exports and final verification

**Files:**
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Update `packages/worker/src/index.ts`**

```ts
export { createWorker, Worker } from "./worker.js";
export { defineWorkerPlugin, isWorkerPlugin } from "./plugin.js";
export { WorkerReactors } from "./reactors.js";
export type {
	BackoffConfig,
	CategoryPolicy,
	RetryPolicy,
	WorkerHookEvent,
	WorkerHookPayloads,
	WorkerHookRegistry,
	WorkerOptions,
	WorkerPlugin,
} from "./types.js";
```

- [ ] **Step 2: Run all worker tests**

Run: `pnpm --filter @rytejs/worker vitest run`
Expected: PASS

- [ ] **Step 3: Build worker dist**

Run: `cd packages/worker && pnpm tsup`
Expected: Builds successfully

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @rytejs/worker tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run lint**

Run: `pnpm biome check packages/worker/`
Expected: PASS (or fix any issues)

- [ ] **Step 6: Run full workspace check**

Run: `pnpm run check`
Expected: PASS across all packages

- [ ] **Step 7: Commit and push**

```bash
git add packages/worker/src/index.ts
git commit -m "feat(worker): finalize exports"
git push
```
