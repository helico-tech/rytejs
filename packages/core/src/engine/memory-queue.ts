import type { EnqueueMessage, QueueAdapter, QueueMessage } from "./types.js";

let nextId = 0;

export function memoryQueue(): QueueAdapter {
	const pending: QueueMessage[] = [];
	const inflight = new Map<string, QueueMessage>();
	const delayed: Array<{ message: QueueMessage; visibleAt: number }> = [];

	return {
		async enqueue(messages: EnqueueMessage[]): Promise<void> {
			for (const msg of messages) {
				pending.push({
					...msg,
					id: `msg-${++nextId}`,
					attempt: 0,
				});
			}
		},

		async dequeue(count: number): Promise<QueueMessage[]> {
			const now = Date.now();
			const stillDelayed: typeof delayed = [];
			for (const entry of delayed) {
				if (now >= entry.visibleAt) {
					pending.push(entry.message);
				} else {
					stillDelayed.push(entry);
				}
			}
			delayed.length = 0;
			delayed.push(...stillDelayed);

			const messages = pending.splice(0, count);
			for (const msg of messages) {
				inflight.set(msg.id, msg);
			}
			return messages;
		},

		async ack(id: string): Promise<void> {
			inflight.delete(id);
		},

		async nack(id: string, delay?: number): Promise<void> {
			const msg = inflight.get(id);
			if (!msg) return;
			inflight.delete(id);
			const retried = { ...msg, attempt: msg.attempt + 1 };
			if (delay && delay > 0) {
				delayed.push({ message: retried, visibleAt: Date.now() + delay });
			} else {
				pending.push(retried);
			}
		},

		async deadLetter(id: string, _reason: string): Promise<void> {
			inflight.delete(id);
		},
	};
}
