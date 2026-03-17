import type { WorkerHookEvent, WorkerHookPayloads, WorkerHookRegistry } from "./types.js";

export interface WorkerHooks extends WorkerHookRegistry {
	emit<E extends WorkerHookEvent>(event: E, payload: WorkerHookPayloads[E]): void;
}

export function createWorkerHooks(): WorkerHooks {
	const listeners = new Map<string, Array<(payload: unknown) => void>>();

	return {
		on<E extends WorkerHookEvent>(
			event: E,
			callback: (payload: WorkerHookPayloads[E]) => void,
		): void {
			const existing = listeners.get(event) ?? [];
			existing.push(callback as (payload: unknown) => void);
			listeners.set(event, existing);
		},

		emit<E extends WorkerHookEvent>(event: E, payload: WorkerHookPayloads[E]): void {
			const cbs = listeners.get(event);
			if (!cbs) return;
			for (const cb of cbs) {
				try {
					cb(payload);
				} catch {
					// Hook errors are isolated — never propagate
				}
			}
		},
	};
}
