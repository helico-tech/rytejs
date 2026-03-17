import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	MigrationPipeline,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowOf,
} from "@rytejs/core";
import type { SyncTransport, TransportError } from "@rytejs/sync";

export interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | TransportError | null;
	readonly connectionStatus?: "connected" | "reconnecting" | "disconnected";
}

export interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig>;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
		options?: { optimistic?: boolean },
	): Promise<DispatchResult<TConfig>>;
	setWorkflow(workflow: Workflow<TConfig>): void;
	cleanup(): void;
}

export interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
	sync?: SyncTransport;
}

export interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly state: StateNames<TConfig>;
	readonly data: StateData<TConfig, StateNames<TConfig>>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | TransportError | null;
	readonly connectionStatus?: "connected" | "reconnecting" | "disconnected";
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
		options?: { optimistic?: boolean },
	): Promise<DispatchResult<TConfig>>;
	match<R>(
		matchers: {
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		},
	): R;
	match<R>(
		matchers: Partial<{
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		}>,
		fallback: (workflow: Workflow<TConfig>) => R,
	): R;
}
