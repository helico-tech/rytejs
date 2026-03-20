import type { StoreAdapter } from "../engine/types.js";
import type { WorkflowExecutor } from "../executor/executor.js";
import type { ExecutionResult } from "../executor/types.js";

// biome-ignore lint/suspicious/noExplicitAny: executor map holds different configs
type ExecutorMap = Record<string, WorkflowExecutor<any>>;

export function createFetch(
	executors: ExecutorMap,
	store: StoreAdapter,
): (request: Request) => Promise<Response> {
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length < 2) {
			return json({ error: "Invalid path — expected /:name/:id" }, 400);
		}

		const name = parts[0] as string;
		const id = parts[1] as string;
		const method = request.method.toUpperCase();

		if (method === "GET") {
			const stored = await store.load(id);
			if (!stored) {
				return json({ error: { category: "not_found", id } }, 404);
			}
			return json({ snapshot: stored.snapshot, version: stored.version }, 200);
		}

		const executor = executors[name];
		if (!executor) {
			return json({ error: { category: "not_found", name } }, 404);
		}

		if (method === "PUT") {
			const body = (await request.json()) as { initialState: string; data: unknown };
			const result = await executor.create(id, body);
			return resultToResponse(result, 201);
		}

		if (method === "POST") {
			const body = (await request.json()) as { type: string; payload: unknown };
			const result = await executor.execute(id, body);
			return resultToResponse(result, 200);
		}

		return json({ error: "Method not allowed" }, 405);
	};
}

function resultToResponse(result: ExecutionResult, successStatus: number): Response {
	if (result.ok) {
		return json(
			{ snapshot: result.snapshot, version: result.version, events: result.events },
			successStatus,
		);
	}

	const status = errorToStatus(result.error.category);
	return json({ error: result.error }, status);
}

function errorToStatus(category: string): number {
	switch (category) {
		case "not_found":
			return 404;
		case "conflict":
		case "already_exists":
			return 409;
		case "validation":
		case "router":
			return 400;
		case "domain":
			return 422;
		case "dependency":
			return 503;
		default:
			return 500;
	}
}

function json(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
