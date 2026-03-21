import type { WorkflowSnapshot } from "@rytejs/core";
import type { SaveOptions, StoreAdapter } from "@rytejs/core/store";
import { ConcurrencyConflictError } from "@rytejs/core/store";

export function createDOStore(storage: DurableObjectStorage): StoreAdapter {
	return {
		async load(id: string) {
			const snapshot = await storage.get<WorkflowSnapshot>(`snapshot:${id}`);
			const version = await storage.get<number>(`version:${id}`);
			if (!snapshot || version === undefined) return null;
			return { snapshot, version };
		},

		async save(options: SaveOptions) {
			const { id, snapshot, expectedVersion } = options;
			const currentVersion = await storage.get<number>(`version:${id}`);

			if (currentVersion === undefined) {
				throw new Error(`Workflow ${id} not found`);
			}
			if (currentVersion !== expectedVersion) {
				throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
			}

			await storage.put(`snapshot:${id}`, { ...snapshot, version: expectedVersion + 1 });
			await storage.put(`version:${id}`, expectedVersion + 1);
		},
	};
}
