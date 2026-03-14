import type { Context } from "./context.js";
import type { CommandNames, StateNames, WorkflowConfig } from "./types.js";

/** Terminal handler function — receives fully typed context with state and command narrowing. */
export type Handler<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig>,
	TCommand extends CommandNames<TConfig>,
> = (ctx: Context<TConfig, TDeps, TState, TCommand>) => void | Promise<void>;
