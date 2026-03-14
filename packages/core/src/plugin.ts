import type { WorkflowRouter } from "./router.js";
import type { WorkflowConfig } from "./types.js";

const PLUGIN_SYMBOL: unique symbol = Symbol.for("ryte:plugin");

/** A branded plugin function that can be passed to router.use(). */
export type Plugin<TConfig extends WorkflowConfig, TDeps> = ((
	router: WorkflowRouter<TConfig, TDeps>,
) => void) & { readonly [PLUGIN_SYMBOL]: true };

/** Brands a function as a Ryte plugin for use with router.use(). */
export function definePlugin<TConfig extends WorkflowConfig, TDeps>(
	fn: (router: WorkflowRouter<TConfig, TDeps>) => void,
): Plugin<TConfig, TDeps> {
	const plugin = fn as Plugin<TConfig, TDeps>;
	Object.defineProperty(plugin, PLUGIN_SYMBOL, { value: true, writable: false });
	return plugin;
}

/** Checks whether a value is a branded Ryte plugin. */
export function isPlugin(value: unknown): value is Plugin<WorkflowConfig, unknown> {
	return typeof value === "function" && PLUGIN_SYMBOL in value;
}
