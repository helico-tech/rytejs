export interface MemoryRedis {
	hset(key: string, fields: Record<string, string>): Promise<number>;
	hgetall(key: string): Promise<Record<string, string> | null>;
	sadd(key: string, member: string): Promise<number>;
	srem(key: string, member: string): Promise<number>;
	smembers(key: string): Promise<string[]>;
	publish(channel: string, message: string): Promise<number>;
	subscribe(channel: string, callback: (message: string) => void): void;
	psubscribe(pattern: string, callback: (channel: string, message: string) => void): void;
}

export function createMemoryRedis(): MemoryRedis {
	const hashes = new Map<string, Map<string, string>>();
	const sets = new Map<string, Set<string>>();
	const subscribers = new Map<string, Set<(message: string) => void>>();
	const patternSubscribers: Array<{
		pattern: RegExp;
		callback: (channel: string, message: string) => void;
	}> = [];

	return {
		async hset(key, fields) {
			if (!hashes.has(key)) hashes.set(key, new Map());
			const hash = hashes.get(key)!;
			let added = 0;
			for (const [field, value] of Object.entries(fields)) {
				if (!hash.has(field)) added++;
				hash.set(field, value);
			}
			return added;
		},

		async hgetall(key) {
			const hash = hashes.get(key);
			if (!hash || hash.size === 0) return null;
			const result: Record<string, string> = {};
			for (const [field, value] of hash) {
				result[field] = value;
			}
			return result;
		},

		async sadd(key, member) {
			if (!sets.has(key)) sets.set(key, new Set());
			const set = sets.get(key)!;
			if (set.has(member)) return 0;
			set.add(member);
			return 1;
		},

		async srem(key, member) {
			const set = sets.get(key);
			if (!set || !set.has(member)) return 0;
			set.delete(member);
			return 1;
		},

		async smembers(key) {
			const set = sets.get(key);
			return set ? [...set] : [];
		},

		async publish(channel, message) {
			let count = 0;
			const subs = subscribers.get(channel);
			if (subs) {
				for (const cb of subs) {
					cb(message);
					count++;
				}
			}
			for (const { pattern, callback } of patternSubscribers) {
				if (pattern.test(channel)) {
					callback(channel, message);
					count++;
				}
			}
			return count;
		},

		subscribe(channel, callback) {
			if (!subscribers.has(channel)) subscribers.set(channel, new Set());
			subscribers.get(channel)!.add(callback);
		},

		psubscribe(pattern, callback) {
			// Convert Redis glob pattern to regex (e.g., "mission:*" → /^mission:.*$/)
			const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
			patternSubscribers.push({ pattern: regex, callback });
		},
	};
}
