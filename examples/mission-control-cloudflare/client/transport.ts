import type { StoredWorkflow } from "@rytejs/core/store";
import type { BroadcastMessage, Transport, TransportResult } from "@rytejs/react";

export function createMissionTransport(): Transport {
	return {
		async load(id: string): Promise<StoredWorkflow | null> {
			const res = await fetch(`/api/missions/${id}`);
			if (!res.ok) return null;
			return res.json();
		},

		async dispatch(id, command, expectedVersion): Promise<TransportResult> {
			const res = await fetch(`/api/missions/${id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...command, expectedVersion }),
			});
			return res.json();
		},

		subscribe(id, callback) {
			const protocol = location.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(`${protocol}//${location.host}/api/missions/${id}/ws`);

			ws.onmessage = (e) => {
				const msg: BroadcastMessage = JSON.parse(e.data);
				callback(msg);
			};

			ws.onerror = () => console.warn(`WebSocket error for ${id}`);

			return {
				unsubscribe: () => ws.close(),
			};
		},
	};
}
