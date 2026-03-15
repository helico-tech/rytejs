import type { StateNames, WorkflowConfig } from "./types.js";

/** A plain, JSON-safe representation of a workflow's state for serialization and storage. */
export interface WorkflowSnapshot<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** Unique workflow instance identifier. */
	readonly id: string;
	/** Name of the workflow definition. */
	readonly definitionName: string;
	/** Current state name. */
	readonly state: StateNames<TConfig>;
	/** State data (untyped — validated on {@link WorkflowDefinition.restore}). */
	readonly data: unknown;
	/** ISO 8601 timestamp of workflow creation. */
	readonly createdAt: string;
	/** ISO 8601 timestamp of last state change. */
	readonly updatedAt: string;
	/** Schema version number for migration support. */
	readonly modelVersion: number;
}
