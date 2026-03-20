const EXECUTOR_PLUGIN_SYMBOL: unique symbol = Symbol.for("ryte:executor-plugin");

// biome-ignore lint/suspicious/noExplicitAny: executor plugin must accept any config
export type ExecutorPlugin = ((executor: any) => void) & {
	readonly [EXECUTOR_PLUGIN_SYMBOL]: true;
};

export function defineExecutorPlugin(
	// biome-ignore lint/suspicious/noExplicitAny: executor plugin must accept any config
	fn: (executor: any) => void,
): ExecutorPlugin {
	const plugin = fn as ExecutorPlugin;
	Object.defineProperty(plugin, EXECUTOR_PLUGIN_SYMBOL, { value: true, writable: false });
	return plugin;
}

export function isExecutorPlugin(value: unknown): value is ExecutorPlugin {
	return typeof value === "function" && EXECUTOR_PLUGIN_SYMBOL in value;
}
