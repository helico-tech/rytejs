import { DurableObject } from "cloudflare:workers";
import type { WorkflowSnapshot } from "@rytejs/core";

export interface MissionEntry {
	id: string;
	snapshot: WorkflowSnapshot;
	version: number;
}

export class MissionIndexDO extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		// WebSocket upgrade for live list updates
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);

			// Send current list immediately
			const missions = await this.getMissions();
			pair[1].send(JSON.stringify({ type: "init", missions }));

			return new Response(null, { status: 101, webSocket: pair[0] });
		}

		const method = request.method;

		// GET — return all missions
		if (method === "GET") {
			const missions = await this.getMissions();
			return Response.json(missions);
		}

		// POST — update a mission entry (called by MissionDO after state changes)
		if (method === "POST") {
			const entry = (await request.json()) as MissionEntry;
			await this.ctx.storage.put(`mission:${entry.id}`, entry);

			// Broadcast update to all connected WebSocket clients
			await this.broadcastList();

			return Response.json({ ok: true });
		}

		return Response.json({ error: "Method not allowed" }, { status: 405 });
	}

	private async getMissions(): Promise<MissionEntry[]> {
		const entries = await this.ctx.storage.list<MissionEntry>({ prefix: "mission:" });
		return [...entries.values()];
	}

	private async broadcastList(): Promise<void> {
		const missions = await this.getMissions();
		const payload = JSON.stringify({ type: "update", missions });
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(payload);
			} catch {
				// disconnected
			}
		}
	}
}
