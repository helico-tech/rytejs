import { MissionDO } from "./mission-do.ts";

export { MissionDO };

export interface Env {
	MISSION: DurableObjectNamespace<MissionDO>;
	ASSETS: Fetcher;
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

			// Forward the request to the DO, adding the mission ID
			if (request.method === "PUT") {
				const body = await request.json();
				return stub.fetch(
					new Request(request.url, {
						method: "PUT",
						headers: request.headers,
						body: JSON.stringify({ ...(body as object), id }),
					}),
				);
			}

			return stub.fetch(request);
		}

		// Everything else: static assets (React SPA)
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
