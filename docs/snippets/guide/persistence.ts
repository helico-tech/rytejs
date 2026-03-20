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

const persistedExecutor = new WorkflowExecutor(taskRouter).use(withStore(store));

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
	console.log(execResult.events); // [{ type: "TaskStarted", ... }]
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
	events: [{ type: "TaskStarted", data: { taskId: "task-1", assignee: "alice" } }],
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
