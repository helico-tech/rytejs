import type { UpdateMessage } from "@rytejs/sync";

export interface CloudflareBroadcaster {
	/** Register a server-side WebSocket. The caller creates the WebSocketPair. */
	handleWebSocket(server: WebSocket): void;
	/** Create and return an SSE ReadableStream response. */
	handleSSE(): Response;
	/** Broadcast an update to all connected WS + SSE clients. */
	broadcast(update: UpdateMessage): void;
	/** Count of active connections (WS + SSE). */
	connectionCount(): number;
	/** Close all connections. */
	close(): void;
}

function formatSSE(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export function cloudflareBroadcaster(ctx: DurableObjectState): CloudflareBroadcaster {
	const sseControllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
	// Track WS count locally so connectionCount() is accurate after close()
	const localWebSockets = new Set<WebSocket>();
	const encoder = new TextEncoder();

	return {
		handleWebSocket(server) {
			ctx.acceptWebSocket(server);
			localWebSockets.add(server);
		},

		handleSSE() {
			let controller: ReadableStreamDefaultController<Uint8Array>;

			const stream = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
					sseControllers.add(c);
				},
				cancel() {
					sseControllers.delete(controller);
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

		broadcast(update) {
			const encoded = encoder.encode(formatSSE(update));

			// Send to SSE clients
			for (const controller of sseControllers) {
				try {
					controller.enqueue(encoded);
				} catch {
					// Controller may be closed
				}
			}

			// Send to WebSocket clients (hibernatable API)
			const websockets = ctx.getWebSockets();
			const json = JSON.stringify(update);
			for (const ws of websockets) {
				try {
					ws.send(json);
				} catch {
					// WebSocket may be closed
				}
			}
		},

		connectionCount() {
			return sseControllers.size + localWebSockets.size;
		},

		close() {
			// Close SSE controllers
			for (const controller of sseControllers) {
				try {
					controller.close();
				} catch {
					// Already closed
				}
			}
			sseControllers.clear();

			// Close WebSocket connections
			for (const ws of localWebSockets) {
				try {
					ws.close(1000, "closing");
				} catch {
					// Already closed
				}
			}
			localWebSockets.clear();
		},
	};
}
