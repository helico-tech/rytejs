import { WorkflowExecutor } from "@rytejs/core/executor";
import { missionDef } from "../shared/mission.ts";
import { createBroadcastManager } from "./broadcast.ts";
import { startCountdownLoop } from "./countdown-loop.ts";
import { createMemoryRedis } from "./memory-redis.ts";
import { createRedisStore } from "./redis-store.ts";
import { createMissionRouter } from "./router.ts";
import { createTelemetryService } from "./telemetry.ts";
import { startTrackingLoop } from "./tracking-loop.ts";

// ── Wire dependencies ──

const redis = createMemoryRedis();
const store = createRedisStore(redis);
const telemetry = createTelemetryService();
const router = createMissionRouter({ telemetry });
const broadcast = createBroadcastManager(redis);
const executor = new WorkflowExecutor(router, store);

// Middleware: broadcast every successful execution (covers HTTP, countdown loop, tracking loop)
executor.use(async (ctx, next) => {
	await next();
	if (ctx.snapshot) {
		await broadcast.publish(ctx.id, ctx.snapshot, ctx.stored.version + 1, ctx.events);
	}
});

// ── CORS headers ──

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", ...CORS_HEADERS },
	});
}

function notFound(message = "Not found"): Response {
	return json({ error: message }, 404);
}

// ── Route handler ──

async function handleRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const { pathname } = url;
	const method = req.method;

	// Preflight
	if (method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	// GET /missions/events — SSE for list updates (must match before /:id)
	if (method === "GET" && pathname === "/missions/events") {
		const stream = new ReadableStream({
			start(controller) {
				const cleanup = broadcast.addListClient(controller);
				// Send initial keepalive
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode(": connected\n\n"));

				// Handle client disconnect via AbortSignal
				req.signal.addEventListener("abort", () => {
					cleanup();
					try {
						controller.close();
					} catch {
						// already closed
					}
				});
			},
		});
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				...CORS_HEADERS,
			},
		});
	}

	// GET /missions — list all missions
	if (method === "GET" && pathname === "/missions") {
		const missions = await store.list();
		return json(missions);
	}

	// Match /missions/:id/events
	const eventsMatch = pathname.match(/^\/missions\/([^/]+)\/events$/);
	if (method === "GET" && eventsMatch) {
		const id = eventsMatch[1]!;
		const stream = new ReadableStream({
			start(controller) {
				const cleanup = broadcast.addMissionClient(id, controller);
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode(": connected\n\n"));

				req.signal.addEventListener("abort", () => {
					cleanup();
					try {
						controller.close();
					} catch {
						// already closed
					}
				});
			},
		});
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				...CORS_HEADERS,
			},
		});
	}

	// Match /missions/:id
	const missionMatch = pathname.match(/^\/missions\/([^/]+)$/);
	if (!missionMatch) {
		return notFound();
	}
	const id = missionMatch[1]!;

	// PUT /missions/:id — Create mission
	if (method === "PUT") {
		const body = await req.json();
		const { name, destination, crewMembers, fuelLevel } = body;

		const workflow = missionDef.createWorkflow(id, {
			initialState: "Planning",
			data: { name, destination, crewMembers, fuelLevel },
		});
		const snapshot = { ...missionDef.serialize(workflow), version: 1 };

		await store.create(id, snapshot);
		await broadcast.publish(id, snapshot, 1, []);

		return json({ snapshot, version: 1 }, 201);
	}

	// POST /missions/:id — Execute command
	if (method === "POST") {
		const body = await req.json();
		const result = await executor.execute(id, body);

		if (result.ok) {
			return json(result);
		}

		// Determine appropriate status code
		const error = result.error;
		if ("category" in error) {
			if (error.category === "not_found") return json(result, 404);
			if (error.category === "conflict") return json(result, 409);
			if (error.category === "validation") return json(result, 400);
			if (error.category === "domain") return json(result, 422);
		}
		return json(result, 500);
	}

	// GET /missions/:id — Load snapshot
	if (method === "GET") {
		const stored = await store.load(id);
		if (!stored) return notFound(`Mission ${id} not found`);
		return json({ snapshot: stored.snapshot, version: stored.version });
	}

	return notFound();
}

// ── Start services ──

broadcast.start();
const tracking = startTrackingLoop(store, executor, telemetry);
const countdownLoop = startCountdownLoop(store, executor);

const server = Bun.serve({
	port: 4000,
	fetch: handleRequest,
});

console.log(`Mission Control server on http://localhost:${server.port}`);

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\nShutting down...");
	tracking.stop();
	countdownLoop.stop();
	broadcast.stop();
	server.stop();
	process.exit(0);
});
