import type { StateNames, WorkflowConfig } from "./types.js";

/** A plain, JSON-safe representation of a workflow's state. */
export interface WorkflowSnapshot<TConfig extends WorkflowConfig = WorkflowConfig> {
	readonly id: string;
	readonly definitionName: string;
	readonly state: StateNames<TConfig>;
	readonly data: unknown;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly modelVersion: number;
}
