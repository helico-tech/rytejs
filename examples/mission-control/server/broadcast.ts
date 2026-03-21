import type { WorkflowSnapshot } from "@rytejs/core";

export interface BroadcastManager {
	publish(
		id: string,
		snapshot: WorkflowSnapshot,
		version: number,
		events: Array<{ type: string; data: unknown }>,
	): Promise<void>;
	addMissionClient(missionId: string, controller: ReadableStreamDefaultController): () => void;
	addListClient(controller: ReadableStreamDefaultController): () => void;
	start(): Promise<void>;
	stop(): void;
}

export function createBroadcastManager(redisUrl?: string): BroadcastManager {
	const url = redisUrl ?? "redis://localhost:6379";
	const encoder = new TextEncoder();

	// biome-ignore lint/suspicious/noExplicitAny: Bun.RedisClient may not exist on all Bun versions
	const RedisClient = (globalThis as any).Bun?.RedisClient;

	function makeClient() {
		if (RedisClient) {
			return new RedisClient(url);
		}
		// biome-ignore lint/suspicious/noExplicitAny: dynamic Bun redis import
		const bun = require("bun") as any;
		return bun.redis ? Object.create(bun.redis) : new bun.RedisClient(url);
	}

	const pubClient = makeClient();
	const subClient = makeClient();

	const missionClients = new Map<string, Set<ReadableStreamDefaultController>>();
	const listClients = new Set<ReadableStreamDefaultController>();
	let subscribed = false;

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
			await pubClient.send("PUBLISH", [`mission:${id}`, message]);
			await pubClient.send("PUBLISH", ["missions:list", message]);
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

		async start(): Promise<void> {
			if (subscribed) return;
			subscribed = true;

			// Subscribe to pattern for mission-specific updates
			await subClient.send("PSUBSCRIBE", ["mission:*"]);
			await subClient.send("SUBSCRIBE", ["missions:list"]);

			// Bun's Redis client delivers messages via an async iterator or callback.
			// We use a polling approach via the subscribe message handler.
			// In Bun's Redis, messages arrive on the subscribe connection automatically.
			// We set up message handlers via the subscribe client's message event.

			// For Bun's native Redis, messages are delivered through the connection.
			// The subClient will receive messages which we fan out to SSE clients.
			const poll = async () => {
				if (!subscribed) return;
				try {
					// Try to read messages using Bun's Redis message API
					// biome-ignore lint/suspicious/noExplicitAny: Bun Redis API varies by version
					const sub = subClient as any;
					if (typeof sub.subscribe === "function") {
						// Bun's Redis subscribe returns an async iterator
						for await (const message of sub.subscribe("missions:list")) {
							if (!subscribed) break;
							const data = JSON.parse(String(message));
							// Fan out to list clients
							for (const client of listClients) {
								sendSSE(client, data);
							}
						}
					}
				} catch {
					// Subscription ended or error
				}
			};

			// Start pattern subscription fan-out
			const pollPattern = async () => {
				if (!subscribed) return;
				try {
					// biome-ignore lint/suspicious/noExplicitAny: Bun Redis API varies by version
					const sub = subClient as any;
					if (typeof sub.psubscribe === "function") {
						for await (const { channel, message } of sub.psubscribe("mission:*")) {
							if (!subscribed) break;
							const data = JSON.parse(String(message));
							// Extract mission ID from channel (mission:{id})
							const missionId = String(channel).replace("mission:", "");
							const clients = missionClients.get(missionId);
							if (clients) {
								for (const client of clients) {
									sendSSE(client, data);
								}
							}
						}
					}
				} catch {
					// Subscription ended or error
				}
			};

			// Run subscriptions in background — don't await
			poll();
			pollPattern();
		},

		stop(): void {
			subscribed = false;
			try {
				subClient.send("PUNSUBSCRIBE", ["mission:*"]);
				subClient.send("UNSUBSCRIBE", ["missions:list"]);
			} catch {
				// Ignore cleanup errors
			}
		},
	};
}
