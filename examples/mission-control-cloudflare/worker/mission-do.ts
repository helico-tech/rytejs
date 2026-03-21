import { DurableObject } from "cloudflare:workers";
import type { WorkflowSnapshot } from "@rytejs/core";
import { WorkflowExecutor } from "@rytejs/core/executor";
import { missionDef } from "../shared/mission.ts";
import { createDOStore } from "./do-store.ts";
import type { Env } from "./index.ts";
import { createMissionRouter } from "./router.ts";
import { createTelemetryService } from "./telemetry.ts";

interface HistoryEntry {
	seq: number;
	timestamp: string;
	type: "command" | "event";
	name: string;
	data: Record<string, unknown>;
}

export class MissionDO extends DurableObject<Env> {
	// biome-ignore lint/suspicious/noExplicitAny: type erasure — executor holds WorkflowConfig base type
	private executor: WorkflowExecutor<any>;
	private store: ReturnType<typeof createDOStore>;
	private telemetry = createTelemetryService();
	private missionId: string | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.store = createDOStore(ctx.storage);
		const router = createMissionRouter({ telemetry: this.telemetry });
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router's TConfig is inferred from source while executor expects dist types
		this.executor = new WorkflowExecutor(router as any, this.store);
	}

	async fetch(request: Request): Promise<Response> {
		const method = request.method;

		// WebSocket upgrade
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);
			return new Response(null, { status: 101, webSocket: pair[0] });
		}

		// PUT — Create mission
		if (method === "PUT") {
			const body = (await request.json()) as {
				name: string;
				destination: string;
				crewMembers: string[];
				fuelLevel: number;
				id: string;
			};
			this.missionId = body.id;

			const workflow = missionDef.createWorkflow(body.id, {
				initialState: "Planning",
				data: {
					name: body.name,
					destination: body.destination,
					crewMembers: body.crewMembers,
					fuelLevel: body.fuelLevel,
				},
			});
			const snapshot = missionDef.serialize(workflow);

			await this.ctx.storage.put(`snapshot:${body.id}`, { ...snapshot, version: 1 });
			await this.ctx.storage.put(`version:${body.id}`, 1);
			await this.ctx.storage.put("missionId", body.id);

			this.broadcast({ snapshot: { ...snapshot, version: 1 }, version: 1, events: [] });

			return Response.json({ snapshot: { ...snapshot, version: 1 }, version: 1 }, { status: 201 });
		}

		// POST — Execute command
		if (method === "POST") {
			const body = (await request.json()) as { type: string; payload: unknown };
			const id = await this.getMissionId();
			if (!id) return Response.json({ error: "No mission" }, { status: 404 });

			const result = await this.executor.execute(id, body);

			if (result.ok) {
				await this.recordHistory(id, body, result);
				this.broadcast({
					snapshot: result.snapshot,
					version: result.version,
					events: result.events,
				});
				// Schedule alarm for countdown/tracking if in active state
				await this.scheduleAlarmIfNeeded(result.snapshot);
			}

			return Response.json(result);
		}

		// GET — Load snapshot or history
		if (method === "GET") {
			const url = new URL(request.url);
			if (url.pathname.endsWith("/history")) {
				const id = await this.getMissionId();
				if (!id) return Response.json({ error: "No mission" }, { status: 404 });
				const historyMap = await this.ctx.storage.list<HistoryEntry>({
					prefix: `history:${id}:`,
				});
				return Response.json([...historyMap.values()]);
			}
			const id = await this.getMissionId();
			if (!id) return Response.json({ error: "No mission" }, { status: 404 });
			const stored = await this.store.load(id);
			if (!stored) return Response.json({ error: "Not found" }, { status: 404 });
			return Response.json(stored);
		}

		// DELETE — Delete mission
		if (method === "DELETE") {
			const id = await this.getMissionId();
			if (!id) return Response.json({ error: "No mission" }, { status: 404 });

			// Clear all storage for this mission
			await this.ctx.storage.deleteAll();
			this.missionId = null;

			// Notify connected WebSocket clients
			for (const ws of this.ctx.getWebSockets()) {
				try {
					ws.send(JSON.stringify({ deleted: true }));
					ws.close(1000, "Mission deleted");
				} catch {
					// Client already disconnected
				}
			}

			return Response.json({ ok: true });
		}

		return Response.json({ error: "Method not allowed" }, { status: 405 });
	}

	async alarm(): Promise<void> {
		const id = await this.getMissionId();
		if (!id) return;

		const stored = await this.store.load(id);
		if (!stored) return;

		const state = stored.snapshot.state;

		if (state === "Countdown") {
			const data = stored.snapshot.data as { secondsRemaining: number };
			if (data.secondsRemaining > 0) {
				const command = {
					type: "UpdateCountdown",
					payload: { secondsRemaining: data.secondsRemaining - 1 },
				};
				const result = await this.executor.execute(id, command);
				if (result.ok) {
					await this.recordHistory(id, command, result);
					this.broadcast({
						snapshot: result.snapshot,
						version: result.version,
						events: result.events,
					});
					await this.notifyIndex(id, result.snapshot, result.version);
					await this.scheduleAlarmIfNeeded(result.snapshot);
				}
			} else {
				// T-0: Launch!
				const command = { type: "Launch", payload: {} };
				const result = await this.executor.execute(id, command);
				if (result.ok) {
					await this.recordHistory(id, command, result);
					this.broadcast({
						snapshot: result.snapshot,
						version: result.version,
						events: result.events,
					});
					await this.notifyIndex(id, result.snapshot, result.version);
					await this.scheduleAlarmIfNeeded(result.snapshot);
				}
			}
		} else if (state === "Ascending") {
			const readings = await this.telemetry.getFlightData(id);
			const analysis = await this.telemetry.analyzeReadings([readings]);

			let command: { type: string; payload: unknown };
			if (analysis.anomaly) {
				command = { type: "TriggerAbort", payload: { reason: analysis.reason as string } };
			} else if (readings.altitude >= 400) {
				command = { type: "AchieveOrbit", payload: {} };
			} else {
				command = {
					type: "UpdateTelemetry",
					payload: {
						altitude: readings.altitude,
						velocity: readings.velocity,
						heading: readings.heading,
					},
				};
			}

			const result = await this.executor.execute(id, command);
			if (result.ok) {
				await this.recordHistory(id, command, result);
				this.broadcast({
					snapshot: result.snapshot,
					version: result.version,
					events: result.events,
				});
				await this.notifyIndex(id, result.snapshot, result.version);
				await this.scheduleAlarmIfNeeded(result.snapshot);
			}
		}
	}

	private async scheduleAlarmIfNeeded(snapshot: WorkflowSnapshot): Promise<void> {
		const state = snapshot.state;
		if (state === "Countdown") {
			// Tick every 1 second
			await this.ctx.storage.setAlarm(Date.now() + 1000);
		} else if (state === "Ascending") {
			// Tracking every 2 seconds
			await this.ctx.storage.setAlarm(Date.now() + 2000);
		}
		// Terminal states: no alarm needed
	}

	private broadcast(message: {
		snapshot: WorkflowSnapshot;
		version: number;
		events: unknown[];
	}): void {
		const sockets = this.ctx.getWebSockets();
		const payload = JSON.stringify(message);
		for (const ws of sockets) {
			try {
				ws.send(payload);
			} catch {
				// Client disconnected
			}
		}
	}

	private async notifyIndex(
		id: string,
		snapshot: WorkflowSnapshot,
		version: number,
	): Promise<void> {
		try {
			const indexId = this.env.MISSION_INDEX.idFromName("global");
			const indexStub = this.env.MISSION_INDEX.get(indexId);
			await indexStub.fetch(
				new Request("http://internal/", {
					method: "POST",
					body: JSON.stringify({ id, snapshot, version }),
					headers: { "Content-Type": "application/json" },
				}),
			);
		} catch {
			// Index notification is best-effort during alarms
		}
	}

	private async getMissionId(): Promise<string | null> {
		if (this.missionId) return this.missionId;
		this.missionId = (await this.ctx.storage.get<string>("missionId")) ?? null;
		return this.missionId;
	}

	private async recordHistory(
		missionId: string,
		command: { type: string; payload: unknown },
		// biome-ignore lint/suspicious/noExplicitAny: executor result type varies
		result: { ok: true; events: Array<{ type: string; data: unknown }> } & Record<string, any>,
	): Promise<HistoryEntry[]> {
		const seqKey = `historySeq:${missionId}`;
		let seq = (await this.ctx.storage.get<number>(seqKey)) ?? 0;
		const timestamp = new Date().toISOString();
		const entries: HistoryEntry[] = [];

		// Record command
		const cmdEntry: HistoryEntry = {
			seq,
			timestamp,
			type: "command",
			name: command.type,
			data: (command.payload ?? {}) as Record<string, unknown>,
		};
		await this.ctx.storage.put(`history:${missionId}:${String(seq).padStart(6, "0")}`, cmdEntry);
		entries.push(cmdEntry);
		seq++;

		// Record each event
		for (const event of result.events) {
			const evtEntry: HistoryEntry = {
				seq,
				timestamp,
				type: "event",
				name: event.type,
				data: (event.data ?? {}) as Record<string, unknown>,
			};
			await this.ctx.storage.put(`history:${missionId}:${String(seq).padStart(6, "0")}`, evtEntry);
			entries.push(evtEntry);
			seq++;
		}

		await this.ctx.storage.put(seqKey, seq);
		return entries;
	}
}
