import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { WorkflowConfig } from "../types.js";
import {
	ConcurrencyConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "./errors.js";
import { withLock } from "./lock.js";
import type { EngineOptions, ExecutionResult, StoreAdapter, StoredWorkflow } from "./types.js";

const DEFAULT_LOCK_TIMEOUT = 30_000;

export class ExecutionEngine {
	private readonly store: StoreAdapter;
	private readonly routers: Record<string, WorkflowRouter<WorkflowConfig>>;
	private readonly lockTimeout: number;

	constructor(options: EngineOptions) {
		this.store = options.store;
		this.routers = options.routers;
		this.lockTimeout = options.lockTimeout ?? DEFAULT_LOCK_TIMEOUT;
	}

	getRouter(name: string): WorkflowRouter<WorkflowConfig> {
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

		return withLock(
			id,
			async () => {
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
						events: [],
						expectedVersion: 0,
					});
				} catch (err) {
					if (err instanceof ConcurrencyConflictError) {
						throw new WorkflowAlreadyExistsError(id);
					}
					throw err;
				}

				return { workflow: snapshot, version: 1 };
			},
			this.lockTimeout,
		);
	}

	async execute(
		routerName: string,
		id: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult> {
		const router = this.getRouter(routerName);
		const definition = router.definition;

		return withLock(
			id,
			async () => {
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
				const events = result.events.map((e) => ({
					type: e.type as string,
					data: e.data,
				}));

				await this.store.save({
					id,
					snapshot: newSnapshot,
					events,
					expectedVersion: stored.version,
				});

				return { result, events, version: stored.version + 1 };
			},
			this.lockTimeout,
		);
	}
}

export function createEngine(options: EngineOptions): ExecutionEngine {
	return new ExecutionEngine(options);
}
