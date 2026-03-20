import type { BroadcastMessage, ExecutorMiddleware, SubscriberRegistry } from "./types.js";

export function createSubscriberRegistry(): SubscriberRegistry {
	const subscribers = new Map<string, Set<(message: BroadcastMessage) => void>>();

	return {
		subscribe(id, callback) {
			let existing = subscribers.get(id);
			if (!existing) {
				existing = new Set();
				subscribers.set(id, existing);
			}
			const set = existing;
			set.add(callback);
			return () => {
				set.delete(callback);
				if (set.size === 0) {
					subscribers.delete(id);
				}
			};
		},

		notify(id, message) {
			const set = subscribers.get(id);
			if (!set) return;
			for (const callback of set) {
				callback(message);
			}
		},
	};
}

export function withBroadcast(subscribers: SubscriberRegistry): ExecutorMiddleware {
	return async (ctx, next) => {
		await next();

		if (ctx.snapshot) {
			subscribers.notify(ctx.id, {
				snapshot: ctx.snapshot,
				version: ctx.version,
				events: ctx.events,
			});
		}
	};
}
