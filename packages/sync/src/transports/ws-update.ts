import type { Subscription, UpdateMessage, UpdateTransport } from "../types.js";

export interface WsUpdateOptions {
	/** Base URL for WebSocket endpoint */
	url: string;
	/** Router name for URL construction */
	router: string;
	/** Reconnect delay in ms after connection drop. Default: 1000 */
	reconnectDelay?: number;
}

function toWsUrl(url: string): string {
	return url.replace(/^http/, "ws");
}

export function wsUpdateTransport(options: WsUpdateOptions): UpdateTransport {
	const { url, router, reconnectDelay = 1000 } = options;

	return {
		subscribe(workflowId: string, listener: (message: UpdateMessage) => void): Subscription {
			let stopped = false;
			let ws: WebSocket | null = null;

			function connect() {
				if (stopped) return;

				const wsUrl = `${toWsUrl(url)}/${router}/${workflowId}/websocket`;
				ws = new WebSocket(wsUrl);

				ws.onmessage = (event: MessageEvent) => {
					try {
						const message = JSON.parse(event.data as string) as UpdateMessage;
						listener(message);
					} catch {
						// Skip malformed messages
					}
				};

				ws.onerror = () => {
					// onerror is always followed by onclose — reconnect there
				};

				ws.onclose = () => {
					if (!stopped) {
						setTimeout(connect, reconnectDelay);
					}
				};
			}

			connect();

			return {
				unsubscribe() {
					stopped = true;
					ws?.close();
				},
			};
		},
	};
}
