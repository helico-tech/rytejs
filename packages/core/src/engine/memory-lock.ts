import type { LockAdapter } from "./types.js";

export function memoryLock(options: { ttl: number }): LockAdapter {
	const locks = new Map<string, number>();

	return {
		async acquire(id: string): Promise<boolean> {
			const existing = locks.get(id);
			if (existing !== undefined && Date.now() < existing) {
				return false;
			}
			locks.set(id, Date.now() + options.ttl);
			return true;
		},

		async release(id: string): Promise<void> {
			locks.delete(id);
		},
	};
}
