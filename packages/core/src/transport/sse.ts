import type { BroadcastMessage } from "../executor/types.js";
import type { Transport, TransportResult, TransportSubscription } from "./types.js";

export function sseTransport(baseUrl: string): Transport {
	return {
		async dispatch(id, command, expectedVersion): Promise<TransportResult> {
			try {
				const res = await fetch(`${baseUrl}/${id}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: command.type,
						payload: command.payload,
						expectedVersion,
					}),
				});

				const body = await res.json();

				if (body.ok) {
					return {
						ok: true,
						snapshot: body.snapshot,
						version: body.version,
						events: body.events ?? [],
					};
				}

				return { ok: false, error: body.error };
			} catch (err) {
				return {
					ok: false,
					error: {
						category: "transport",
						code: "NETWORK",
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}
		},

		subscribe(id, callback): TransportSubscription {
			const url = `${baseUrl}/${id}`;

			// EventSource may not be available in all environments (e.g., Node.js without polyfill)
			if (typeof EventSource === "undefined") {
				return { unsubscribe() {} };
			}

			const source = new EventSource(url);

			source.addEventListener("message", (event) => {
				try {
					const message: BroadcastMessage = JSON.parse(event.data);
					callback(message);
				} catch {
					// Ignore malformed messages
				}
			});

			return {
				unsubscribe() {
					source.close();
				},
			};
		},
	};
}
