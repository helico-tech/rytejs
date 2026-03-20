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
import type { BroadcastMessage } from "@rytejs/core/transport";
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

	if (options?.transport && !initialConfig.id) {
		throw new Error("Transport requires a workflow id");
	}

	let workflow: Workflow<TConfig> = loadOrCreate(definition, initialConfig, options);
	let isDispatching = false;
	let error: PipelineError<TConfig> | null = null;
	let snapshot: WorkflowStoreSnapshot<TConfig> = { workflow, isDispatching, error };
	const listeners = new Set<() => void>();
	let version = 0;

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

		// Transport: server-authoritative dispatch
		if (options?.transport) {
			// biome-ignore lint/style/noNonNullAssertion: id is guaranteed by the guard at createWorkflowStore entry
			const workflowId = initialConfig.id!;
			const transportResult = await options.transport.dispatch(
				workflowId,
				{ type: command as string, payload },
				version,
			);

			if (transportResult.ok) {
				const restored = definition.restore(transportResult.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					version = transportResult.version;
					error = null;
					isDispatching = false;
					notify();
					return { ok: true, workflow: restored.workflow, events: [] } as DispatchResult<TConfig>;
				}
			}

			// Error path
			error = (transportResult.ok ? null : transportResult.error) as PipelineError<TConfig> | null;
			isDispatching = false;
			notify();
			return {
				ok: false,
				error: error ?? {
					category: "unexpected",
					error: new Error("Transport error"),
					message: "Transport error",
				},
			} as DispatchResult<TConfig>;
		}

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

	let transportSubscription: { unsubscribe(): void } | undefined;
	if (options?.transport && initialConfig.id) {
		transportSubscription = options.transport.subscribe(
			initialConfig.id,
			(message: BroadcastMessage) => {
				const restored = definition.restore(message.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					version = message.version;
					error = null;
					notify();
				}
			},
		);
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
			transportSubscription?.unsubscribe();
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
