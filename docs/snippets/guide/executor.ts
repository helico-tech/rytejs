import type { ExecutorMiddleware } from "@rytejs/core/executor";
import { WorkflowExecutor } from "@rytejs/core/executor";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/store";
import { ConcurrencyConflictError, memoryStore } from "@rytejs/core/store";
import { taskRouter, taskWorkflow } from "../fixtures.js";

// #region adapters
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

// #region memory-store
const store = memoryStore();
// #endregion memory-store

// #region create-executor
const executor = new WorkflowExecutor(taskRouter, store);
// #endregion create-executor

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

// #region expected-version
(async () => {
	const result = await executor.execute(
		"task-1",
		{ type: "Start", payload: { assignee: "alice" } },
		{ expectedVersion: 1 },
	);

	if (!result.ok && result.error.category === "conflict") {
		console.log("Stale version — reload and retry");
	}
})();
// #endregion expected-version

// #region middleware
const authMiddleware: ExecutorMiddleware = async (ctx, next) => {
	// Middleware sees the loaded workflow — check permissions
	const ownerField = (ctx.stored.snapshot.data as { owner?: string }).owner;
	if (ownerField !== "current-user") {
		ctx.result = {
			ok: false as const,
			error: { category: "not_found" as const, id: ctx.id },
		};
		return; // short-circuit — don't call next()
	}
	await next();
};

executor.use(authMiddleware);
// #endregion middleware

// #region error-handling
(async () => {
	try {
		await pgStore.save({
			id: "task-1",
			snapshot: {} as Parameters<typeof pgStore.save>[0]["snapshot"],
			expectedVersion: 1,
		});
	} catch (err) {
		if (err instanceof ConcurrencyConflictError) {
			console.log("Conflict:", err.workflowId, err.expectedVersion, err.actualVersion);
		}
	}
})();
// #endregion error-handling

void pgStore;
