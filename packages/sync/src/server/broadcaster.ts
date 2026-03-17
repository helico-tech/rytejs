import type { ExecutionResult } from "@rytejs/core/engine";
import type { Broadcaster, BroadcasterOptions } from "./types.js";

function compositeKey(routerName: string, workflowId: string): string {
	return `${routerName}:${workflowId}`;
}

function formatSSE(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export function createBroadcaster(options: BroadcasterOptions): Broadcaster {
	const { engine } = options;
	const connections = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
	const encoder = new TextEncoder();

	function getOrCreateSet(key: string): Set<ReadableStreamDefaultController<Uint8Array>> {
		let set = connections.get(key);
		if (!set) {
			set = new Set();
			connections.set(key, set);
		}
		return set;
	}

	function broadcast(key: string, data: unknown): void {
		const set = connections.get(key);
		if (!set) return;

		const encoded = encoder.encode(formatSSE(data));
		for (const controller of set) {
			try {
				controller.enqueue(encoded);
			} catch {
				// Controller may be closed — cleanup happens on cancel
			}
		}
	}

	return {
		async execute(routerName, workflowId, command): Promise<ExecutionResult> {
			const result = await engine.execute(routerName, workflowId, command);

			if (result.result.ok) {
				const router = engine.getRouter(routerName);
				const snapshot = router.definition.snapshot(result.result.workflow);
				broadcast(compositeKey(routerName, workflowId), {
					snapshot,
					version: result.version,
				});
			}

			return result;
		},

		async subscribe(routerName, workflowId): Promise<Response> {
			const stored = await engine.load(workflowId);
			const key = compositeKey(routerName, workflowId);

			let streamController: ReadableStreamDefaultController<Uint8Array>;

			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamController = controller;
					getOrCreateSet(key).add(controller);

					// Send initial snapshot
					if (stored) {
						controller.enqueue(
							encoder.encode(formatSSE({ snapshot: stored.snapshot, version: stored.version })),
						);
					}
				},
				cancel() {
					const set = connections.get(key);
					if (set) {
						set.delete(streamController);
						if (set.size === 0) {
							connections.delete(key);
						}
					}
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			});
		},

		connectionCount(routerName, workflowId): number {
			const set = connections.get(compositeKey(routerName, workflowId));
			return set ? set.size : 0;
		},

		close(): void {
			for (const [key, set] of connections) {
				for (const controller of set) {
					try {
						controller.close();
					} catch {
						// Already closed
					}
				}
				set.clear();
			}
			connections.clear();
		},
	};
}
