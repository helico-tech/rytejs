import type { WorkflowSnapshot } from "@rytejs/core";
import type { MemoryRedis } from "./memory-redis.ts";

export interface BroadcastManager {
	publish(
		id: string,
		snapshot: WorkflowSnapshot,
		version: number,
		events: Array<{ type: string; data: unknown }>,
	): Promise<void>;
	publishDeletion(id: string): Promise<void>;
	addMissionClient(missionId: string, controller: ReadableStreamDefaultController): () => void;
	addListClient(controller: ReadableStreamDefaultController): () => void;
	start(): void;
	stop(): void;
}

export function createBroadcastManager(redis: MemoryRedis): BroadcastManager {
	const encoder = new TextEncoder();

	const missionClients = new Map<string, Set<ReadableStreamDefaultController>>();
	const listClients = new Set<ReadableStreamDefaultController>();
	let started = false;

	function sendSSE(controller: ReadableStreamDefaultController, data: unknown): void {
		try {
			const payload = `data: ${JSON.stringify(data)}\n\n`;
			controller.enqueue(encoder.encode(payload));
		} catch {
			// Client disconnected — ignore
		}
	}

	return {
		async publish(
			id: string,
			snapshot: WorkflowSnapshot,
			version: number,
			events: Array<{ type: string; data: unknown }>,
		): Promise<void> {
			const message = JSON.stringify({ id, snapshot, version, events });
			await redis.publish(`mission:${id}`, message);
			await redis.publish("missions:list", message);
		},

		async publishDeletion(id: string): Promise<void> {
			const message = JSON.stringify({ id, deleted: true });
			await redis.publish(`mission:${id}`, message);
			await redis.publish("missions:list", message);
		},

		addMissionClient(missionId: string, controller: ReadableStreamDefaultController): () => void {
			if (!missionClients.has(missionId)) {
				missionClients.set(missionId, new Set());
			}
			missionClients.get(missionId)!.add(controller);

			return () => {
				const clients = missionClients.get(missionId);
				if (clients) {
					clients.delete(controller);
					if (clients.size === 0) {
						missionClients.delete(missionId);
					}
				}
			};
		},

		addListClient(controller: ReadableStreamDefaultController): () => void {
			listClients.add(controller);
			return () => {
				listClients.delete(controller);
			};
		},

		start(): void {
			if (started) return;
			started = true;

			// Subscribe to list updates
			redis.subscribe("missions:list", (message) => {
				const data = JSON.parse(message);
				for (const client of listClients) {
					sendSSE(client, data);
				}
			});

			// Subscribe to mission-specific updates via pattern
			redis.psubscribe("mission:*", (channel, message) => {
				const missionId = channel.replace("mission:", "");
				const clients = missionClients.get(missionId);
				if (clients) {
					const data = JSON.parse(message);
					for (const client of clients) {
						sendSSE(client, data);
					}
				}
			});
		},

		stop(): void {
			started = false;
		},
	};
}
