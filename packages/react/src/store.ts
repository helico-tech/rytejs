import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
} from "@rytejs/core";
import { migrate, type WorkflowRouter } from "@rytejs/core";
import type { TransportError } from "@rytejs/sync";
import type { WorkflowStore, WorkflowStoreOptions, WorkflowStoreSnapshot } from "./types.js";

export function createWorkflowStore<
	TConfig extends WorkflowConfig,
	TDeps,
	S extends StateNames<TConfig>,
>(
	router: WorkflowRouter<TConfig, TDeps>,
	initialConfig: {
		state: S;
		data: StateData<TConfig, S>;
		id?: string;
	},
	options?: WorkflowStoreOptions<TConfig>,
): WorkflowStore<TConfig> {
	if (options?.sync && !initialConfig.id) {
		throw new Error("Sync transport requires a workflow id");
	}

	const definition = router.definition;

	let workflow: Workflow<TConfig> = loadOrCreate(definition, initialConfig, options);
	let isDispatching = false;
	let error: PipelineError<TConfig> | TransportError | null = null;
	let snapshot: WorkflowStoreSnapshot<TConfig> = { workflow, isDispatching, error };

	const listeners = new Set<() => void>();

	function notify() {
		snapshot = { workflow, isDispatching, error };
		for (const listener of listeners) {
			listener();
		}
	}

	const dispatch = async <C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
		dispatchOptions?: { optimistic?: boolean },
	): Promise<DispatchResult<TConfig>> => {
		isDispatching = true;
		notify();

		// Sync: server-authoritative (default when sync is provided)
		if (options?.sync && !dispatchOptions?.optimistic) {
			const commandResult = await options.sync.dispatch(initialConfig.id!, {
				type: command as string,
				payload,
			});

			if (commandResult.ok) {
				const restored = definition.restore(commandResult.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					error = null;
					isDispatching = false;
					notify();
					return {
						ok: true,
						workflow: restored.workflow,
						events: [],
					} as DispatchResult<TConfig>;
				}
			}

			// Error path: transport error, pipeline error, or restore failure
			error = commandResult.ok
				? ({
						category: "transport",
						code: "PARSE",
						message: "Failed to restore server snapshot",
					} as TransportError)
				: (commandResult.error as PipelineError<TConfig> | TransportError);
			isDispatching = false;
			notify();
			return { ok: false, error } as DispatchResult<TConfig>;
		}

		// Local dispatch (no sync, or optimistic — optimistic handled in Task 10)
		const result = await router.dispatch(workflow, { type: command, payload });

		if (result.ok) {
			workflow = result.workflow;
			error = null;
		} else {
			error = result.error;
		}
		isDispatching = false;
		notify();

		if (result.ok && options?.persist) {
			const { key, storage } = options.persist;
			const snap = definition.snapshot(workflow);
			storage.setItem(key, JSON.stringify(snap));
		}

		return result;
	};

	// Sync subscription wiring
	let syncSubscription: { unsubscribe(): void } | undefined;
	if (options?.sync) {
		syncSubscription = options.sync.subscribe(initialConfig.id!, (message) => {
			const restored = definition.restore(message.snapshot);
			if (restored.ok) {
				workflow = restored.workflow;
				error = null;
				notify();
			} else {
				error = {
					category: "transport",
					code: "PARSE",
					message: "Failed to restore snapshot from server",
				} as TransportError;
				notify();
			}
		});
	}

	return {
		getWorkflow: () => workflow,
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispatch,
		setWorkflow: (newWorkflow) => {
			workflow = newWorkflow;
			error = null;
			notify();
		},
		cleanup() {
			syncSubscription?.unsubscribe();
		},
	};
}

function loadOrCreate<TConfig extends WorkflowConfig, S extends StateNames<TConfig>>(
	definition: WorkflowDefinition<TConfig>,
	initialConfig: { state: S; data: StateData<TConfig, S>; id?: string },
	options?: WorkflowStoreOptions<TConfig>,
): Workflow<TConfig> {
	if (options?.persist) {
		const { key, storage, migrations } = options.persist;
		try {
			const stored = storage.getItem(key);
			if (stored) {
				// biome-ignore lint/suspicious/noExplicitAny: JSON.parse returns unknown structure from storage
				let parsed: any = JSON.parse(stored);
				if (migrations) {
					const migrated = migrate(migrations, parsed);
					if (migrated.ok) {
						parsed = migrated.snapshot;
					} else {
						return createFresh(definition, initialConfig);
					}
				}
				const restored = definition.restore(parsed);
				if (restored.ok) {
					return restored.workflow;
				}
			}
		} catch {
			// Invalid JSON or restore failed — fall through to create fresh
		}
	}

	return createFresh(definition, initialConfig);
}

function createFresh<TConfig extends WorkflowConfig, S extends StateNames<TConfig>>(
	definition: WorkflowDefinition<TConfig>,
	initialConfig: { state: S; data: StateData<TConfig, S>; id?: string },
): Workflow<TConfig> {
	return definition.createWorkflow(initialConfig.id ?? crypto.randomUUID(), {
		initialState: initialConfig.state,
		data: initialConfig.data,
	});
}
