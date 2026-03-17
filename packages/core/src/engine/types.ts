import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { DispatchResult, WorkflowConfig } from "../types.js";

export interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface EmittedEvent {
	type: string;
	data: unknown;
}

export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	events: EmittedEvent[];
	expectedVersion: number;
}

export interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}

export interface EngineOptions {
	store: StoreAdapter;
	routers: Record<string, WorkflowRouter<WorkflowConfig>>;
	lockTimeout?: number;
}

export interface ExecutionResult {
	result: DispatchResult<WorkflowConfig>;
	events: EmittedEvent[];
	version: number;
}
