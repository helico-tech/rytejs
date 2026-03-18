import { DurableObject } from "cloudflare:workers";
import type { WorkflowRouter } from "@rytejs/core";
import {
	ConcurrencyConflictError,
	ExecutionEngine,
	LockConflictError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "@rytejs/core/engine";
import { type CloudflareBroadcaster, cloudflareBroadcaster } from "../adapters/broadcaster.js";
import { cloudflareLock } from "../adapters/lock.js";
import { cloudflareStore } from "../adapters/store.js";

export abstract class WorkflowDO extends DurableObject {
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router array — each router has a different TConfig
	abstract routers: WorkflowRouter<any>[];

	private _engine?: ExecutionEngine;
	private _broadcaster?: CloudflareBroadcaster;

	private get engine(): ExecutionEngine {
		if (!this._engine) {
			// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router map — type erasure required
			const routerMap: Record<string, WorkflowRouter<any>> = {};
			for (const router of this.routers) {
				const name = router.definition.name;
				if (routerMap[name]) {
					throw new Error(`Duplicate router name: "${name}"`);
				}
				routerMap[name] = router;
			}
			this._engine = new ExecutionEngine({
				store: cloudflareStore(this.ctx.storage),
				routers: routerMap,
				lock: cloudflareLock(),
			});
		}
		return this._engine;
	}

	private get broadcaster(): CloudflareBroadcaster {
		if (!this._broadcaster) {
			this._broadcaster = cloudflareBroadcaster(this.ctx);
		}
		return this._broadcaster;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const routerName = request.headers.get("X-Router-Name") ?? "";
		const workflowId = request.headers.get("X-Workflow-Id") ?? "";

		try {
			if (request.method === "PUT" && (path === "/create" || path === "/")) {
				return await this.handleCreate(routerName, workflowId, request);
			}
			if (request.method === "POST" && (path === "/dispatch" || path === "/")) {
				return await this.handleDispatch(routerName, workflowId, request);
			}
			if (request.method === "GET" && path === "/events") {
				return this.broadcaster.handleSSE();
			}
			if (request.method === "GET" && path === "/websocket") {
				return this.handleWebSocket();
			}
			if (request.method === "GET" && (path === "/snapshot" || path === "/")) {
				return await this.handleSnapshot(workflowId);
			}

			return this.jsonResponse(
				{ ok: false, error: { category: "router", message: "Not found" } },
				404,
			);
		} catch (err) {
			return this.handleError(err);
		}
	}

	webSocketClose(_ws: WebSocket) {
		// Hibernatable WS cleanup — handled automatically by ctx.getWebSockets()
	}

	webSocketError(_ws: WebSocket) {
		// Hibernatable WS cleanup — handled automatically by ctx.getWebSockets()
	}

	private async handleCreate(
		routerName: string,
		workflowId: string,
		request: Request,
	): Promise<Response> {
		const body = (await request.json()) as { initialState: string; data: unknown };
		const result = await this.engine.create(routerName, workflowId, {
			initialState: body.initialState,
			data: body.data,
		});
		return this.jsonResponse({ ok: true, snapshot: result.workflow, version: result.version }, 201);
	}

	private async handleDispatch(
		routerName: string,
		workflowId: string,
		request: Request,
	): Promise<Response> {
		const body = (await request.json()) as { type: string; payload: unknown };
		const result = await this.engine.execute(routerName, workflowId, {
			type: body.type,
			payload: body.payload,
		});

		if (result.result.ok) {
			const router = this.engine.getRouter(routerName);
			// biome-ignore lint/suspicious/noExplicitAny: type erasure at engine boundary
			const snapshot = router.definition.snapshot(result.result.workflow as any);
			this.broadcaster.broadcast({ snapshot, version: result.version });
			return this.jsonResponse({ ok: true, snapshot, version: result.version });
		}

		const error = result.result.error;
		const status = error.category === "validation" ? 422 : error.category === "domain" ? 422 : 500;
		return this.jsonResponse({ ok: false, error }, status);
	}

	private async handleSnapshot(workflowId: string): Promise<Response> {
		const stored = await this.engine.load(workflowId);
		if (!stored) {
			return this.jsonResponse(
				{ ok: false, error: { category: "not_found", message: "Workflow not found" } },
				404,
			);
		}
		return this.jsonResponse({
			ok: true,
			snapshot: stored.snapshot,
			version: stored.version,
		});
	}

	private handleWebSocket(): Response {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.broadcaster.handleWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	private handleError(err: unknown): Response {
		if (err instanceof WorkflowNotFoundError) {
			return this.jsonResponse(
				{ ok: false, error: { category: "not_found", message: err.message } },
				404,
			);
		}
		if (err instanceof WorkflowAlreadyExistsError || err instanceof ConcurrencyConflictError) {
			return this.jsonResponse(
				{ ok: false, error: { category: "conflict", message: err.message } },
				409,
			);
		}
		if (err instanceof LockConflictError) {
			return this.jsonResponse(
				{ ok: false, error: { category: "locked", message: err.message } },
				409,
			);
		}
		const message = err instanceof Error ? err.message : String(err);
		return this.jsonResponse({ ok: false, error: { category: "unexpected", message } }, 500);
	}

	private jsonResponse(body: unknown, status = 200): Response {
		return new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}
}
