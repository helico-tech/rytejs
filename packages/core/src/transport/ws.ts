import type { Transport, TransportResult, TransportSubscription } from "./types.js";

/**
 * WebSocket transport — full-duplex dispatch + subscribe over a single connection.
 *
 * NOTE: Not yet implemented. WebSocket upgrade varies across runtimes
 * (Cloudflare uses WebSocketPair, Deno uses Deno.upgradeWebSocket, Node needs ws).
 * Use sseTransport or pollingTransport until a runtime-specific WS adapter ships.
 */
export function wsTransport(_url: string): Transport {
	return {
		async dispatch(_id, _command, _expectedVersion): Promise<TransportResult> {
			return {
				ok: false,
				error: {
					category: "transport",
					code: "NETWORK",
					message: "wsTransport is not yet implemented — use sseTransport or pollingTransport",
				},
			};
		},

		subscribe(_id, _callback): TransportSubscription {
			return { unsubscribe() {} };
		},
	};
}
