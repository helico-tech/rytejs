import type { WorkflowSnapshot } from "../snapshot.js";

export interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
	events?: Array<{ type: string; data: unknown }>;
}

export interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}
