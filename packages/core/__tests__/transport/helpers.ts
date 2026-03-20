import { memoryStore } from "../../src/engine/memory-store.js";
import type { StoreAdapter } from "../../src/engine/types.js";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import type { SubscriberRegistry } from "../../src/executor/types.js";
import { createSubscriberRegistry, withBroadcast } from "../../src/executor/with-broadcast.js";
import { withStore } from "../../src/executor/with-store.js";
import type { WorkflowRouter } from "../../src/router.js";
import type { WorkflowConfig } from "../../src/types.js";

export interface MockServer {
	readonly store: StoreAdapter;
	readonly subscribers: SubscriberRegistry;
	readonly executor: WorkflowExecutor<WorkflowConfig>;
	fetch(request: Request): Promise<Response>;
}

export function createMockServer<TConfig extends WorkflowConfig>(
	router: WorkflowRouter<TConfig>,
): MockServer {
	const store = memoryStore();
	const subscribers = createSubscriberRegistry();

	// biome-ignore lint/suspicious/noExplicitAny: type erasure — mock server operates on base config
	const executor = new WorkflowExecutor(router as WorkflowRouter<any>);
	executor.use(withBroadcast(subscribers));
	executor.use(withStore(store));

	const fetch = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);
		const id = parts[0];
		const method = request.method.toUpperCase();

		if (method === "GET") {
			const stored = await store.load(id);
			if (!stored) {
				return Response.json(
					{ ok: false, error: { category: "transport", code: "NOT_FOUND", message: "Not found" } },
					{ status: 404 },
				);
			}
			return Response.json({
				ok: true,
				snapshot: stored.snapshot,
				version: stored.version,
				events: [],
			});
		}

		if (method === "POST") {
			const body = (await request.json()) as {
				type: string;
				payload: unknown;
				expectedVersion?: number;
			};
			const result = await executor.execute(id, {
				type: body.type,
				payload: body.payload,
			});
			if (result.ok) {
				return Response.json(result);
			}
			const status =
				result.error.category === "not_found"
					? 404
					: result.error.category === "conflict"
						? 409
						: 400;
			return Response.json({ ok: false, error: result.error }, { status });
		}

		if (method === "PUT") {
			const body = (await request.json()) as { initialState: string; data: unknown };
			const result = await executor.create(id, body);
			if (result.ok) {
				return Response.json(result, { status: 201 });
			}
			return Response.json({ ok: false, error: result.error }, { status: 409 });
		}

		return new Response("Method not allowed", { status: 405 });
	};

	return { store, subscribers, executor, fetch };
}
