import { MissionDO } from "./mission-do.ts";
import { MissionIndexDO } from "./mission-index-do.ts";

export { MissionDO, MissionIndexDO };

export interface Env {
	MISSION: DurableObjectNamespace<MissionDO>;
	MISSION_INDEX: DurableObjectNamespace<MissionIndexDO>;
	ASSETS: Fetcher;
}

function getIndexStub(env: Env) {
	const id = env.MISSION_INDEX.idFromName("global");
	return env.MISSION_INDEX.get(id);
}

async function notifyIndex(
	env: Env,
	missionId: string,
	snapshot: unknown,
	version: number,
): Promise<void> {
	const stub = getIndexStub(env);
	await stub.fetch(
		new Request("http://internal/", {
			method: "POST",
			body: JSON.stringify({ id: missionId, snapshot, version }),
			headers: { "Content-Type": "application/json" },
		}),
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;

		// CORS
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Upgrade",
				},
			});
		}

		// GET /api/missions — list all missions from MissionIndexDO
		if (pathname === "/api/missions" && request.method === "GET") {
			const stub = getIndexStub(env);
			return stub.fetch(new Request("http://internal/", { method: "GET" }));
		}

		// GET /api/missions/ws — WebSocket to MissionIndexDO for live list updates
		if (pathname === "/api/missions/ws") {
			const stub = getIndexStub(env);
			return stub.fetch(request);
		}

		// Match /api/missions/:id or /api/missions/:id/ws
		const match = pathname.match(/^\/api\/missions\/([^/]+)(\/ws)?$/);
		if (match) {
			const id = match[1]!;
			const isWs = match[2] === "/ws";

			// Get or create the DO for this mission
			const doId = env.MISSION.idFromName(id);
			const stub = env.MISSION.get(doId);

			if (isWs) {
				// WebSocket upgrade — forward to DO
				return stub.fetch(request);
			}

			// PUT — Create mission
			if (request.method === "PUT") {
				const body = await request.json();
				const response = await stub.fetch(
					new Request(request.url, {
						method: "PUT",
						headers: request.headers,
						body: JSON.stringify({ ...(body as object), id }),
					}),
				);

				if (response.ok) {
					const data = (await response.clone().json()) as {
						snapshot: unknown;
						version: number;
					};
					await notifyIndex(env, id, data.snapshot, data.version);
				}

				return response;
			}

			// POST — Execute command
			if (request.method === "POST") {
				const body = await request.text();
				const response = await stub.fetch(
					new Request(request.url, {
						method: "POST",
						headers: request.headers,
						body,
					}),
				);

				if (response.ok) {
					const data = (await response.clone().json()) as {
						ok?: boolean;
						snapshot?: unknown;
						version?: number;
					};
					if (data.ok && data.snapshot) {
						await notifyIndex(env, id, data.snapshot, data.version!);
					}
				}

				return response;
			}

			return stub.fetch(request);
		}

		// Everything else: static assets (React SPA)
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
