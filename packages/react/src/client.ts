import type {
	CommandNames,
	CommandPayload,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
} from "@rytejs/core";
import type { Transport, TransportError, TransportResult } from "./transport.js";

export interface RemoteWorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig> | null;
	readonly isLoading: boolean;
	readonly isDispatching: boolean;
	readonly error: TransportError | null;
}

export interface RemoteWorkflowStore<TConfig extends WorkflowConfig> {
	getSnapshot(): RemoteWorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<TransportResult>;
	cleanup(): void;
}

export interface WorkflowClient {
	connect<TConfig extends WorkflowConfig>(
		definition: WorkflowDefinition<TConfig>,
		id: string,
	): RemoteWorkflowStore<TConfig>;
}

export function createWorkflowClient(transport: Transport): WorkflowClient {
	// biome-ignore lint/suspicious/noExplicitAny: cache stores keyed by string, values are type-erased RemoteWorkflowStore instances
	const cache = new Map<string, RemoteWorkflowStore<any>>();

	return {
		connect<TConfig extends WorkflowConfig>(
			definition: WorkflowDefinition<TConfig>,
			id: string,
		): RemoteWorkflowStore<TConfig> {
			const cacheKey = `${definition.name}:${id}`;
			const existing = cache.get(cacheKey);
			if (existing) {
				return existing as RemoteWorkflowStore<TConfig>;
			}

			const store = createRemoteStore(transport, definition, id);
			cache.set(cacheKey, store);
			return store;
		},
	};
}

function createRemoteStore<TConfig extends WorkflowConfig>(
	transport: Transport,
	definition: WorkflowDefinition<TConfig>,
	id: string,
): RemoteWorkflowStore<TConfig> {
	let workflow: Workflow<TConfig> | null = null;
	let version = 0;
	let isLoading = true;
	let isDispatching = false;
	let error: TransportError | null = null;
	let disposed = false;

	const listeners = new Set<() => void>();

	let snapshot: RemoteWorkflowStoreSnapshot<TConfig> = {
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
				const restored = definition.restore(result.snapshot);
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
				category: "transport",
				code: "NETWORK",
				message: err instanceof Error ? err.message : String(err),
			};
			isLoading = false;
			notify();
		});

	// Subscribe to live broadcasts
	const subscription = transport.subscribe(id, (message) => {
		if (disposed) return;
		const restored = definition.restore(message.snapshot);
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
	): Promise<TransportResult> => {
		if (isLoading) {
			return {
				ok: false,
				error: {
					category: "transport",
					code: "CONFLICT",
					message: "Cannot dispatch while loading",
				},
			};
		}

		isDispatching = true;
		notify();

		try {
			const result = await transport.dispatch(id, { type: command as string, payload }, version);

			if (result.ok) {
				const restored = definition.restore(result.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					version = result.version;
					error = null;
				}
			}

			isDispatching = false;
			notify();
			return result;
		} catch (err: unknown) {
			const transportError: TransportError = {
				category: "transport",
				code: "NETWORK",
				message: err instanceof Error ? err.message : String(err),
			};
			error = transportError;
			isDispatching = false;
			notify();
			return { ok: false, error: transportError };
		}
	};

	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispatch,
		cleanup() {
			disposed = true;
			subscription.unsubscribe();
		},
	};
}
