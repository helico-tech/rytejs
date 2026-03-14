import type { Context } from "./context.js";
import type { CommandNames, StateNames, WorkflowConfig } from "./types.js";

/**
 * Read-only subset of Context for hook callbacks.
 * Includes context-key access (set/get) but excludes dispatch mutation methods.
 */
export type ReadonlyContext<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig> = StateNames<TConfig>,
	TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> = Omit<
	Context<TConfig, TDeps, TState, TCommand>,
	"update" | "transition" | "emit" | "error" | "getWorkflowSnapshot"
>;
