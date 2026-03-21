import type { StoredWorkflow } from "@rytejs/core/store";
import type { BroadcastMessage, Transport, TransportResult } from "@rytejs/react";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MissionTransportOptions {
	/** Base URL for fetch API calls (load, dispatch). Use "" for same-origin via Vite proxy. */
	apiUrl: string;
	/** Base URL for SSE EventSource connections. Must bypass Vite proxy (direct to server). */
	sseUrl: string;
}

export function createMissionTransport(options: MissionTransportOptions): Transport {
	const { apiUrl, sseUrl } = options;

	return {
		async load(id: string): Promise<StoredWorkflow | null> {
			const res = await fetch(`${apiUrl}/missions/${id}`);
			if (!res.ok) return null;
			return res.json();
		},

		async dispatch(id, command, expectedVersion): Promise<TransportResult> {
			await sleep(100 + Math.random() * 200);
			const res = await fetch(`${apiUrl}/missions/${id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...command, expectedVersion }),
			});
			return res.json();
		},

		subscribe(id, callback) {
			const source = new EventSource(`${sseUrl}/missions/${id}/events`);
			source.onmessage = (e) => callback(JSON.parse(e.data) as BroadcastMessage);
			source.onerror = () => console.warn(`SSE error for ${id}, reconnecting...`);
			return { unsubscribe: () => source.close() };
		},
	};
}
