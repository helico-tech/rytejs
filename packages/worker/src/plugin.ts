import type { WorkerHookRegistry, WorkerPlugin } from "./types.js";

const WORKER_PLUGIN_BRAND = "@rytejs/worker/plugin" as const;

export function defineWorkerPlugin(fn: (hooks: WorkerHookRegistry) => void): WorkerPlugin {
	const plugin = fn as WorkerPlugin;
	Object.defineProperty(plugin, "__brand", { value: WORKER_PLUGIN_BRAND });
	return plugin;
}

export function isWorkerPlugin(value: unknown): value is WorkerPlugin {
	return (
		typeof value === "function" &&
		"__brand" in value &&
		(value as WorkerPlugin).__brand === WORKER_PLUGIN_BRAND
	);
}
