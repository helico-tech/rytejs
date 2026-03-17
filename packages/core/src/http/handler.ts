import {
	ConcurrencyConflictError,
	LockConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "../engine/errors.js";
import type { HttpHandlerOptions } from "./types.js";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function errorResponse(status: number, category: string, message: string): Response {
	return jsonResponse(status, {
		ok: false,
		error: { category, message },
	});
}

function mapEngineError(err: unknown): Response {
	if (err instanceof WorkflowNotFoundError) {
		return errorResponse(404, "not_found", err.message);
	}
	if (err instanceof RouterNotFoundError) {
		return errorResponse(404, "not_found", err.message);
	}
	if (err instanceof WorkflowAlreadyExistsError) {
		return errorResponse(409, "conflict", err.message);
	}
	if (err instanceof ConcurrencyConflictError) {
		return errorResponse(409, "conflict", err.message);
	}
	if (err instanceof LockConflictError) {
		return errorResponse(409, "conflict", err.message);
	}
	if (err instanceof RestoreError) {
		return errorResponse(500, "restore_error", err.message);
	}
	const message = err instanceof Error ? err.message : String(err);
	return errorResponse(500, "unexpected", message);
}

function parsePath(url: string, basePath: string): { name: string; id: string } | null {
	const parsed = new URL(url);
	let pathname = parsed.pathname;

	if (basePath && pathname.startsWith(basePath)) {
		pathname = pathname.slice(basePath.length);
	}

	// Ensure leading slash
	if (!pathname.startsWith("/")) {
		pathname = `/${pathname}`;
	}

	const segments = pathname.split("/").filter(Boolean);
	if (segments.length < 2 || !segments[0] || !segments[1]) return null;

	return { name: segments[0], id: segments.slice(1).join("/") };
}

export function createHandler(
	options: HttpHandlerOptions,
): (request: Request) => Promise<Response> {
	const { engine, basePath = "" } = options;

	return async (request: Request): Promise<Response> => {
		const route = parsePath(request.url, basePath);
		if (!route) {
			return errorResponse(400, "bad_request", "Invalid path: expected /:name/:id");
		}

		const { name, id } = route;
		const method = request.method.toUpperCase();

		if (method === "GET") {
			try {
				const stored = await engine.load(id);
				if (!stored) {
					return errorResponse(404, "not_found", `Workflow "${id}" not found`);
				}
				return jsonResponse(200, {
					ok: true,
					workflow: stored.snapshot,
					version: stored.version,
				});
			} catch (err) {
				return mapEngineError(err);
			}
		}

		if (method === "PUT") {
			const contentType = request.headers.get("Content-Type");
			if (!contentType || !contentType.includes("application/json")) {
				return errorResponse(400, "bad_request", "Content-Type must be application/json");
			}

			let body: { initialState?: string; data?: unknown };
			try {
				body = await request.json();
			} catch {
				return errorResponse(400, "bad_request", "Malformed JSON body");
			}

			if (!body.initialState) {
				return errorResponse(400, "bad_request", "Missing required field: initialState");
			}

			try {
				const result = await engine.create(name, id, {
					initialState: body.initialState,
					data: body.data,
				});
				return jsonResponse(201, {
					ok: true,
					workflow: result.workflow,
					version: result.version,
				});
			} catch (err) {
				return mapEngineError(err);
			}
		}

		if (method === "POST") {
			const contentType = request.headers.get("Content-Type");
			if (!contentType || !contentType.includes("application/json")) {
				return errorResponse(400, "bad_request", "Content-Type must be application/json");
			}

			let body: { type?: string; payload?: unknown };
			try {
				body = await request.json();
			} catch {
				return errorResponse(400, "bad_request", "Malformed JSON body");
			}

			if (!body.type) {
				return errorResponse(400, "bad_request", "Missing required field: type");
			}

			try {
				const execResult = await engine.execute(name, id, {
					type: body.type,
					payload: body.payload,
				});

				if (!execResult.result.ok) {
					const error = execResult.result.error;
					const statusMap: Record<string, number> = {
						domain: 422,
						validation: 400,
						router: 400,
						dependency: 503,
						unexpected: 500,
					};
					const status = statusMap[error.category] ?? 500;
					return jsonResponse(status, { ok: false, error });
				}

				return jsonResponse(200, {
					ok: true,
					workflow: execResult.result.workflow,
					events: execResult.events,
					version: execResult.version,
				});
			} catch (err) {
				return mapEngineError(err);
			}
		}

		return errorResponse(405, "method_not_allowed", `Method ${method} not allowed`);
	};
}
