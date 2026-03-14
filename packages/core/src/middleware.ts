import type { Context } from "./context.js";
import type { CommandNames, StateNames, WorkflowConfig } from "./types.js";

/**
 * Koa-style middleware function with full context narrowing via defaults.
 *
 * - Global middleware: `Middleware<TConfig, TDeps>` — union of all states/commands
 * - State-scoped: `Middleware<TConfig, TDeps, "draft">` — narrowed to state
 * - Inline: `Middleware<TConfig, TDeps, "draft", "publish">` — fully narrowed
 */
export type Middleware<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig> = StateNames<TConfig>,
	TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> = (
	ctx: Context<TConfig, TDeps, TState, TCommand>,
	next: () => Promise<void>,
) => Promise<void>;
