import type { BroadcastMessage } from "../executor/types.js";
import type { Transport, TransportResult, TransportSubscription } from "./types.js";

export function pollingTransport(baseUrl: string, interval = 5000): Transport {
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
			let lastVersion = -1;
			let stopped = false;
			let timer: ReturnType<typeof setInterval> | null = null;

			const poll = async () => {
				if (stopped) return;
				try {
					const res = await fetch(`${baseUrl}/${id}`);
					if (!res.ok) return;
					const body = (await res.json()) as {
						ok: boolean;
						snapshot: BroadcastMessage["snapshot"];
						version: number;
					};
					if (!body.ok) return;
					if (body.version !== lastVersion) {
						lastVersion = body.version;
						callback({
							snapshot: body.snapshot,
							version: body.version,
							events: [],
						});
					}
				} catch {
					// Ignore poll failures — will retry on next interval
				}
			};

			timer = setInterval(poll, interval);

			return {
				unsubscribe() {
					stopped = true;
					if (timer !== null) {
						clearInterval(timer);
						timer = null;
					}
				},
			};
		},
	};
}
