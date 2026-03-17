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
	const definition = router.definition;

	let workflow: Workflow<TConfig> = loadOrCreate(definition, initialConfig, options);
	let isDispatching = false;
	let error: PipelineError<TConfig> | null = null;
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
	): Promise<DispatchResult<TConfig>> => {
		isDispatching = true;
		notify();

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
