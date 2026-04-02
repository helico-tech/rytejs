import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	PipelineError,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
} from "@rytejs/core";
import type { BroadcastMessage, Transport } from "./transport.js";
import type { WorkflowStore, WorkflowStoreSnapshot } from "./types.js";

export function createWorkflowClient(transport: Transport) {
	// biome-ignore lint/suspicious/noExplicitAny: cache stores keyed by string, values are type-erased WorkflowStore instances
	const cache = new Map<string, WorkflowStore<any>>();

	return {
		connect<TConfig extends WorkflowConfig>(
			definition: WorkflowDefinition<TConfig>,
			id: string,
		): WorkflowStore<TConfig> {
			const cacheKey = `${definition.name}:${id}`;
			const existing = cache.get(cacheKey);
			if (existing) {
				return existing as WorkflowStore<TConfig>;
			}

			const store = createRemoteStore(transport, definition, id, () => cache.delete(cacheKey));
			cache.set(cacheKey, store);
			return store;
		},
	};
}

function createRemoteStore<TConfig extends WorkflowConfig>(
	transport: Transport,
	definition: WorkflowDefinition<TConfig>,
	id: string,
	onDispose: () => void,
): WorkflowStore<TConfig> {
	let workflow: Workflow<TConfig> | null = null;
	let version = 0;
	let isLoading = true;
	let isDispatching = false;
	let error: PipelineError<TConfig> | null = null;
	let disposed = false;

	const listeners = new Set<() => void>();

	let snapshot: WorkflowStoreSnapshot<TConfig> = {
		workflow,
		isLoading,
		isDispatching,
		error,
	};

	function notify() {
		if (disposed) return;
		snapshot = { workflow, isLoading, isDispatching, error };
		for (const listener of listeners) {
			listener();
		}
	}

	// Eagerly load
	transport
		.load(id)
		.then((result) => {
			if (disposed) return;
			if (result !== null) {
				const restored = definition.deserialize(result.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					version = result.version;
				}
			}
			isLoading = false;
			notify();
		})
		.catch((err: unknown) => {
			if (disposed) return;
			error = {
				category: "unexpected",
				error: err,
				message: err instanceof Error ? err.message : String(err),
				// biome-ignore lint/suspicious/noExplicitAny: TransportError mapped to PipelineError shape for interface conformance
			} as any;
			isLoading = false;
			notify();
		});

	// Subscribe to live broadcasts
	const subscription = transport.subscribe(id, (message: BroadcastMessage) => {
		if (disposed) return;
		const restored = definition.deserialize(message.snapshot);
		if (restored.ok) {
			workflow = restored.workflow;
			version = message.version;
			error = null;
			notify();
		}
	});

	const dispatch = async <C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>> => {
		if (isLoading) {
			return {
				ok: false,
				error: {
					category: "unexpected",
					error: new Error("Cannot dispatch while loading"),
					message: "Cannot dispatch while loading",
				},
			} as DispatchResult<TConfig>;
		}

		isDispatching = true;
		notify();

		try {
			const result = await transport.dispatch(id, { type: command as string, payload }, version);

			if (result.ok) {
				const restored = definition.deserialize(result.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					version = result.version;
					error = null;
					isDispatching = false;
					notify();
					return {
						ok: true,
						workflow: restored.workflow,
						events: result.events,
					} as DispatchResult<TConfig>;
				}
			}

			// Error path
			// biome-ignore lint/suspicious/noExplicitAny: TransportError mapped to PipelineError shape
			error = (result.ok ? null : result.error) as any;
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
		} catch (err: unknown) {
			error = {
				category: "unexpected",
				error: err,
				message: err instanceof Error ? err.message : String(err),
				// biome-ignore lint/suspicious/noExplicitAny: network error mapped to PipelineError shape
			} as any;
			isDispatching = false;
			notify();
			return {
				ok: false,
				// biome-ignore lint/style/noNonNullAssertion: error is always assigned in the catch block above
				error: error!,
			} as DispatchResult<TConfig>;
		}
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
		cleanup() {
			disposed = true;
			subscription.unsubscribe();
			onDispose();
		},
	};
}
