import { ConcurrencyConflictError } from "./errors.js";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "./types.js";

export function memoryStore(): StoreAdapter {
	const data = new Map<string, StoredWorkflow>();

	return {
		async load(id) {
			return data.get(id) ?? null;
		},

		async save(options: SaveOptions) {
			const { id, snapshot, expectedVersion } = options;
			const existing = data.get(id);
			const currentVersion = existing?.version ?? 0;

			if (currentVersion !== expectedVersion) {
				throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
			}

			data.set(id, { snapshot, version: currentVersion + 1 });
		},
	};
}
