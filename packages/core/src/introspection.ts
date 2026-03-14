import type { CommandNames, ErrorCodes, EventNames, StateNames, WorkflowConfig } from "./types.js";

/** Static shape of a workflow definition — states, commands, events, errors. */
export interface DefinitionInfo<TConfig extends WorkflowConfig> {
	readonly name: string;
	readonly states: readonly StateNames<TConfig>[];
	readonly commands: readonly CommandNames<TConfig>[];
	readonly events: readonly EventNames<TConfig>[];
	readonly errors: readonly ErrorCodes<TConfig>[];
}

/** A single transition edge in the workflow graph. */
export interface TransitionInfo<TConfig extends WorkflowConfig> {
	readonly from: StateNames<TConfig>;
	readonly command: CommandNames<TConfig>;
	readonly to: readonly StateNames<TConfig>[];
}

/** Full transition graph of a router — includes the definition info plus transitions. */
export interface RouterGraph<TConfig extends WorkflowConfig> {
	readonly definition: DefinitionInfo<TConfig>;
	readonly transitions: readonly TransitionInfo<TConfig>[];
}
