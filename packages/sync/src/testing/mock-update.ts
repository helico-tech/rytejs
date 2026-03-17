import type { Subscription, UpdateMessage, UpdateTransport } from "../types.js";

export function mockUpdateTransport(): UpdateTransport & {
	push(workflowId: string, message: UpdateMessage): void;
	disconnect(): void;
	reconnect(): void;
} {
	const subscribers = new Map<string, Set<(message: UpdateMessage) => void>>();
	let connected = true;

	return {
		subscribe(workflowId, listener) {
			if (!subscribers.has(workflowId)) {
				subscribers.set(workflowId, new Set());
			}
			const set = subscribers.get(workflowId)!;
			set.add(listener);

			return {
				unsubscribe() {
					set.delete(listener);
				},
			};
		},

		push(workflowId, message) {
			if (!connected) return;
			const set = subscribers.get(workflowId);
			if (set) {
				for (const listener of set) {
					listener(message);
				}
			}
		},

		disconnect() {
			connected = false;
		},

		reconnect() {
			connected = true;
		},
	};
}
