import type { WorkflowRouter } from "./router.js";
import type { WorkflowConfig } from "./types.js";

const PLUGIN_SYMBOL: unique symbol = Symbol.for("ryte:plugin");

/** A branded plugin function that can be passed to {@link WorkflowRouter.use}. */
export type Plugin<TConfig extends WorkflowConfig, TDeps> = ((
	router: WorkflowRouter<TConfig, TDeps>,
) => void) & { readonly [PLUGIN_SYMBOL]: true };

/**
 * Brands a function as a Ryte plugin for use with {@link WorkflowRouter.use}.
 *
 * @param fn - A function that configures a router (adds handlers, middleware, hooks)
 * @returns A branded {@link Plugin} function
 */
export function definePlugin<TConfig extends WorkflowConfig, TDeps>(
	fn: (router: WorkflowRouter<TConfig, TDeps>) => void,
): Plugin<TConfig, TDeps> {
	const plugin = fn as Plugin<TConfig, TDeps>;
	Object.defineProperty(plugin, PLUGIN_SYMBOL, { value: true, writable: false });
	return plugin;
}

/**
 * Checks whether a value is a branded Ryte plugin.
 *
 * @param value - The value to check
 * @returns `true` if the value is a {@link Plugin}
 */
export function isPlugin(value: unknown): value is Plugin<WorkflowConfig, unknown> {
	return typeof value === "function" && PLUGIN_SYMBOL in value;
}
