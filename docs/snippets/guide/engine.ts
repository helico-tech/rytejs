import type {
	ExecutionResult,
	LockAdapter,
	QueueAdapter,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
} from "@rytejs/core/engine";
import {
	ConcurrencyConflictError,
	createEngine,
	LockConflictError,
	memoryAdapter,
	memoryLock,
	memoryQueue,
	memoryStore,
} from "@rytejs/core/engine";
import { createHandler } from "@rytejs/core/http";
import { taskRouter } from "../fixtures.js";

// ── #adapters ────────────────────────────────────────────────────────────────

// #region adapters
// StoreAdapter — persist workflow snapshots
const pgStore: StoreAdapter = {
	async load(id: string): Promise<StoredWorkflow | null> {
		// SELECT snapshot, version FROM workflows WHERE id = $1
		throw new Error(`Not implemented: load(${id})`);
	},
	async save(options: SaveOptions): Promise<void> {
		// UPDATE workflows SET snapshot = $2, version = version + 1
		//   WHERE id = $1 AND version = $3
		// Throw ConcurrencyConflictError if rowCount === 0
		throw new Error(`Not implemented: save(${options.id})`);
	},
};

// LockAdapter — prevent concurrent execution for the same workflow
const pgLock: LockAdapter = {
	async acquire(id: string): Promise<boolean> {
		// SELECT pg_try_advisory_lock(hashtext($1))
		throw new Error(`Not implemented: acquire(${id})`);
	},
	async release(id: string): Promise<void> {
		// SELECT pg_advisory_unlock(hashtext($1))
		throw new Error(`Not implemented: release(${id})`);
	},
};

// QueueAdapter — enqueue events for async processing
const pgQueue: QueueAdapter = {
	async enqueue(messages) {
		// INSERT INTO outbox (workflow_id, router, type, payload)
		throw new Error(`Not implemented: enqueue(${messages.length} messages)`);
	},
	async dequeue(count: number) {
		// SELECT ... FROM outbox ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED
		throw new Error(`Not implemented: dequeue(${count})`);
	},
	async ack(id: string) {
		// DELETE FROM outbox WHERE id = $1
		throw new Error(`Not implemented: ack(${id})`);
	},
	async nack(id: string, delay?: number) {
		// UPDATE outbox SET visible_at = now() + $2 WHERE id = $1
		throw new Error(`Not implemented: nack(${id}, ${delay})`);
	},
	async deadLetter(id: string, reason: string) {
		// INSERT INTO dead_letters SELECT *, $2 FROM outbox WHERE id = $1
		throw new Error(`Not implemented: deadLetter(${id}, ${reason})`);
	},
};
// #endregion adapters

// ── #memory-adapters ─────────────────────────────────────────────────────────

// #region memory-adapters
const store = memoryStore();
const lock = memoryLock({ ttl: 30_000 });
const queue = memoryQueue();
// #endregion memory-adapters

// ── #transactional ───────────────────────────────────────────────────────────

// #region transactional
const adapter = memoryAdapter({ ttl: 30_000 });

// adapter implements StoreAdapter & QueueAdapter & LockAdapter & TransactionalAdapter
// When store === queue, the engine uses adapter.transaction() to save + enqueue atomically
const txEngine = createEngine({
	store: adapter,
	queue: adapter,
	lock: adapter,
	routers: { task: taskRouter },
});
// #endregion transactional

// ── #create-engine ───────────────────────────────────────────────────────────

// #region create-engine
const engine = createEngine({
	store: memoryStore(),
	lock: memoryLock({ ttl: 30_000 }),
	queue: memoryQueue(),
	routers: {
		task: taskRouter,
	},
});
// #endregion create-engine

// ── #create-workflow ─────────────────────────────────────────────────────────

// #region create-workflow
(async () => {
	const { workflow, version } = await engine.create("task", "task-1", {
		initialState: "Todo",
		data: { title: "Write docs", priority: 0 },
	});

	console.log(workflow); // WorkflowSnapshot
	console.log(version); // 1
})();
// #endregion create-workflow

// ── #execute ─────────────────────────────────────────────────────────────────

// #region execute
(async () => {
	const result: ExecutionResult = await engine.execute("task", "task-1", {
		type: "Start",
		payload: { assignee: "alice" },
	});

	if (result.result.ok) {
		console.log(result.result.workflow.state); // "InProgress"
		console.log(result.events); // [{ type: "TaskStarted", ... }]
		console.log(result.version); // 2
	} else {
		console.log(result.result.error.category);
	}
})();
// #endregion execute

// ── #http-handler ────────────────────────────────────────────────────────────

// #region http-handler
const handle = createHandler({
	engine,
	basePath: "/api/workflows",
});

// Use with any Web Standard API compatible server:
// Bun:    Bun.serve({ fetch: handle })
// Deno:   Deno.serve(handle)
// Node:   see @hono/node-server or similar adapter

// PUT  /api/workflows/task/order-1    — create workflow
// POST /api/workflows/task/order-1    — execute command
// GET  /api/workflows/task/order-1    — load workflow
// #endregion http-handler

// ── #error-handling ──────────────────────────────────────────────────────────

// #region error-handling
(async () => {
	try {
		await engine.execute("task", "task-1", {
			type: "Complete",
			payload: {},
		});
	} catch (err) {
		if (err instanceof LockConflictError) {
			// Another process is executing a command on this workflow
			console.log("Retry later:", err.workflowId);
		}
		if (err instanceof ConcurrencyConflictError) {
			// Workflow was modified between load and save (optimistic locking)
			console.log("Conflict:", err.workflowId, err.expectedVersion, err.actualVersion);
		}
	}
})();
// #endregion error-handling

void pgStore;
void pgLock;
void pgQueue;
void store;
void lock;
void queue;
void txEngine;
void handle;
