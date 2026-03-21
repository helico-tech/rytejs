import type { WorkflowSnapshot } from "@rytejs/core";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/store";
import { ConcurrencyConflictError } from "@rytejs/core/store";
import { RedisClient } from "bun";

export interface RedisStoreAdapter extends StoreAdapter {
	create(id: string, snapshot: WorkflowSnapshot): Promise<void>;
	findByState(state: string): Promise<Array<{ id: string }>>;
	list(): Promise<Array<{ id: string; snapshot: WorkflowSnapshot; version: number }>>;
}

const SAVE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'version')
if current == false then
  return redis.error_reply('NOT_FOUND')
end
if tonumber(current) ~= tonumber(ARGV[1]) then
  return redis.error_reply('CONFLICT:' .. current)
end
redis.call('HSET', KEYS[1], 'snapshot', ARGV[2], 'version', tonumber(ARGV[1]) + 1)
if ARGV[3] ~= '' then
  redis.call('SREM', 'missions:state:' .. ARGV[3], ARGV[5])
end
redis.call('SADD', 'missions:state:' .. ARGV[4], ARGV[5])
return 'OK'
`;

export function createRedisStore(redisUrl?: string): RedisStoreAdapter {
	const redis = new RedisClient(redisUrl ?? "redis://localhost:6379");

	return {
		async create(id: string, snapshot: WorkflowSnapshot): Promise<void> {
			const key = `mission:${id}`;
			const snapshotJson = JSON.stringify(snapshot);
			await redis.hset(key, { snapshot: snapshotJson, version: "1" });
			await redis.sadd("missions:all", id);
			await redis.sadd(`missions:state:${snapshot.state}`, id);
		},

		async load(id: string): Promise<StoredWorkflow | null> {
			const key = `mission:${id}`;
			const data = await redis.hgetall(key);
			if (!data || !data.snapshot) return null;
			return {
				snapshot: JSON.parse(data.snapshot),
				version: Number.parseInt(data.version, 10),
			};
		},

		async save(options: SaveOptions): Promise<void> {
			const { id, snapshot, expectedVersion } = options;
			const key = `mission:${id}`;

			// Load the current snapshot to determine old state
			const current = await redis.hgetall(key);
			const oldState = current?.snapshot
				? (JSON.parse(current.snapshot) as WorkflowSnapshot).state
				: "";
			const newState = snapshot.state;
			const snapshotJson = JSON.stringify(snapshot);

			try {
				await redis.send("EVAL", [
					SAVE_SCRIPT,
					"1",
					key,
					String(expectedVersion),
					snapshotJson,
					oldState,
					newState,
					id,
				]);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("CONFLICT:")) {
					const actualVersion = Number.parseInt(msg.split("CONFLICT:")[1] ?? "0", 10);
					throw new ConcurrencyConflictError(id, expectedVersion, actualVersion);
				}
				if (msg.includes("NOT_FOUND")) {
					throw new Error(`Workflow ${id} not found in store`);
				}
				throw err;
			}
		},

		async findByState(state: string): Promise<Array<{ id: string }>> {
			const ids = await redis.smembers(`missions:state:${state}`);
			return ids.map((id) => ({ id }));
		},

		async list(): Promise<Array<{ id: string; snapshot: WorkflowSnapshot; version: number }>> {
			const ids = await redis.smembers("missions:all");
			const results: Array<{ id: string; snapshot: WorkflowSnapshot; version: number }> = [];
			for (const id of ids) {
				const stored = await this.load(id);
				if (stored) {
					results.push({ id, snapshot: stored.snapshot, version: stored.version });
				}
			}
			return results;
		},
	};
}
