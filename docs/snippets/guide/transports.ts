import type {
	BroadcastMessage,
	Transport,
	TransportError,
	TransportResult,
	TransportSubscription,
} from "@rytejs/core/transport";
import { pollingTransport, sseTransport, wsTransport } from "@rytejs/core/transport";

// #region transport-interface
// The Transport interface — two methods: dispatch + subscribe
const transport: Transport = {
	async dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult> {
		// Send command to server, return result
		void id;
		void command;
		void expectedVersion;
		throw new Error("Not implemented");
	},

	subscribe(id: string, callback: (message: BroadcastMessage) => void): TransportSubscription {
		// Listen for server-pushed updates
		void id;
		void callback;
		return { unsubscribe() {} };
	},
};
// #endregion transport-interface

// #region sse-transport
// SSE transport — POST for dispatch, EventSource for subscribe
const sse = sseTransport("http://localhost:3000/task");

// Dispatch sends POST to http://localhost:3000/task/:id
// Subscribe connects EventSource to http://localhost:3000/task/:id
// #endregion sse-transport

// #region polling-transport
// Polling transport — POST for dispatch, interval polling for subscribe
const polling = pollingTransport("http://localhost:3000/task", 3000);

// Dispatch sends POST to http://localhost:3000/task/:id
// Subscribe polls GET http://localhost:3000/task/:id every 3 seconds
// Only fires callback when version changes
// #endregion polling-transport

// #region ws-transport
// WebSocket transport — not yet implemented
// WebSocket upgrade varies across runtimes:
//   Cloudflare: WebSocketPair
//   Deno: Deno.upgradeWebSocket
//   Node: ws library
// Use sseTransport or pollingTransport until a runtime-specific WS adapter ships
const ws = wsTransport("ws://localhost:3000/task");
// #endregion ws-transport

// #region error-handling
// TransportResult follows the same result pattern
const handleResult = (result: TransportResult) => {
	if (result.ok) {
		console.log("Success:", result.snapshot, result.version);
		return;
	}

	const error = result.error;
	if (error.category === "transport") {
		const transportError = error as TransportError;
		switch (transportError.code) {
			case "NETWORK":
				console.log("Network error — check connectivity");
				break;
			case "CONFLICT":
				console.log("Version conflict — refetch and retry");
				break;
			case "NOT_FOUND":
				console.log("Workflow not found");
				break;
			case "TIMEOUT":
				console.log("Request timed out");
				break;
		}
	} else {
		// Domain/validation errors pass through from the server
		console.log("Server error:", error.category);
	}
};
// #endregion error-handling

void transport;
void sse;
void polling;
void ws;
void handleResult;
