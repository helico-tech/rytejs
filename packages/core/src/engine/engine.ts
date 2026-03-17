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
			const events: EmittedEvent[] = (result.events as Array<{ type: string; data: unknown }>).map(
				(e) => ({
					type: e.type,
					data: e.data,
				}),
			);

			const enqueueMessages = events.map((e) => ({
				workflowId: id,
				routerName: definition.name,
				type: e.type,
				payload: e.data,
			}));

			const useTransaction =
				this.queue &&
				(this.store as unknown) === (this.queue as unknown) &&
				hasTransaction(this.store);
			if (useTransaction) {
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
