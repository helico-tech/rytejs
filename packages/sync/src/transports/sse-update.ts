import type { Subscription, UpdateMessage, UpdateTransport } from "../types.js";

export interface SseUpdateOptions {
	/** Base URL for SSE endpoint */
	url: string;
	/** Router name for URL construction */
	router: string;
	/** Headers for the connection (auth, etc.) */
	headers?: Record<string, string> | (() => Record<string, string>);
	/** Reconnect delay in ms after connection drop. Default: 1000 */
	reconnectDelay?: number;
}

export function sseUpdateTransport(options: SseUpdateOptions): UpdateTransport {
	const { url, router, headers, reconnectDelay = 1000 } = options;

	return {
		subscribe(workflowId, listener) {
			const abortController = new AbortController();
			let stopped = false;

			function connect() {
				if (stopped) return;

				const resolvedHeaders = typeof headers === "function" ? headers() : (headers ?? {});

				fetch(`${url}/${router}/${workflowId}/events`, {
					headers: {
						Accept: "text/event-stream",
						...resolvedHeaders,
					},
					signal: abortController.signal,
				})
					.then((response) => {
						if (!response.body) return;
						const reader = response.body.getReader();
						const decoder = new TextDecoder();
						let buffer = "";

						function read(): Promise<void> {
							return reader.read().then(({ done, value }) => {
								if (done || stopped) return;

								buffer += decoder.decode(value, { stream: true });

								const parts = buffer.split("\n\n");
								// Last element is incomplete — keep in buffer
								buffer = parts.pop() ?? "";

								for (const part of parts) {
									const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
									if (!dataLine) continue;

									try {
										const json = JSON.parse(dataLine.slice(6)) as UpdateMessage;
										listener(json);
									} catch {
										// Skip malformed messages
									}
								}

								return read();
							});
						}

						return read();
					})
					.catch(() => {
						if (!stopped) {
							setTimeout(connect, reconnectDelay);
						}
					});
			}

			connect();

			return {
				unsubscribe() {
					stopped = true;
					abortController.abort();
				},
			};
		},
	};
}
