import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/engine";
import { ConcurrencyConflictError, memoryStore } from "@rytejs/core/engine";
import { WorkflowExecutor, withStore } from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
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
// #endregion adapters

// ── #memory-store ───────────────────────────────────────────────────────────

// #region memory-store
const store = memoryStore();
// #endregion memory-store

// ── #create-executor ────────────────────────────────────────────────────────

// #region create-executor
const executor = new WorkflowExecutor(taskRouter).use(withStore(store));
// #endregion create-executor

// ── #create-workflow ────────────────────────────────────────────────────────

// #region create-workflow
(async () => {
	const result = await executor.create("task-1", {
		initialState: "Todo",
		data: { title: "Write docs", priority: 0 },
	});

	if (result.ok) {
		console.log(result.snapshot); // WorkflowSnapshot
		console.log(result.version); // 1
	}
})();
// #endregion create-workflow

// ── #execute ────────────────────────────────────────────────────────────────

// #region execute
(async () => {
	const result = await executor.execute("task-1", {
		type: "Start",
		payload: { assignee: "alice" },
	});

	if (result.ok) {
		console.log(result.snapshot); // WorkflowSnapshot with state "InProgress"
		console.log(result.events); // [{ type: "TaskStarted", ... }]
		console.log(result.version); // 2
	} else {
		console.log(result.error);
	}
})();
// #endregion execute

// ── #http-handler ───────────────────────────────────────────────────────────

// #region http-handler
const fetch = createFetch({ task: executor }, store);

// Use with any Web Standard API compatible server:
// Bun:    Bun.serve({ fetch })
// Deno:   Deno.serve(fetch)
// Node:   see @hono/node-server or similar adapter

// PUT  /task/order-1    — create workflow
// POST /task/order-1    — execute command
// GET  /task/order-1    — load workflow
// #endregion http-handler

// ── #error-handling ─────────────────────────────────────────────────────────

// #region error-handling
(async () => {
	try {
		const store = pgStore;
		await store.save({
			id: "task-1",
			snapshot: {} as Parameters<typeof store.save>[0]["snapshot"],
			expectedVersion: 1,
		});
	} catch (err) {
		if (err instanceof ConcurrencyConflictError) {
			// Workflow was modified between load and save (optimistic locking)
			console.log("Conflict:", err.workflowId, err.expectedVersion, err.actualVersion);
		}
	}
})();
// #endregion error-handling

void pgStore;
void fetch;
