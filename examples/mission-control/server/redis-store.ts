import type { WorkflowSnapshot } from "@rytejs/core";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/store";
import { ConcurrencyConflictError } from "@rytejs/core/store";
import type { MemoryRedis } from "./memory-redis.ts";

export interface RedisStoreAdapter extends StoreAdapter {
	create(id: string, snapshot: WorkflowSnapshot): Promise<void>;
	findByState(state: string): Promise<Array<{ id: string }>>;
	list(): Promise<Array<{ id: string; snapshot: WorkflowSnapshot; version: number }>>;
}

export function createRedisStore(redis: MemoryRedis): RedisStoreAdapter {
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

			const current = await redis.hgetall(key);
			if (!current) {
				throw new Error(`Workflow ${id} not found in store`);
			}

			const currentVersion = Number.parseInt(current.version, 10);
			if (currentVersion !== expectedVersion) {
				throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
			}

			const oldState = current.snapshot
				? (JSON.parse(current.snapshot) as WorkflowSnapshot).state
				: "";
			const newState = snapshot.state;

			await redis.hset(key, {
				snapshot: JSON.stringify(snapshot),
				version: String(expectedVersion + 1),
			});

			if (oldState) {
				await redis.srem(`missions:state:${oldState}`, id);
			}
			await redis.sadd(`missions:state:${newState}`, id);
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
