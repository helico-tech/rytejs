import { describe, expect, test, vi } from "vitest";

// Mock Cloudflare's DurableObject base class — must be set before dynamic import
globalThis.DurableObject = class {
	ctx: unknown;
	env: unknown;
	constructor(ctx: unknown, env: unknown) {
		this.ctx = ctx;
		this.env = env;
	}
} as never;

// Import after global is set up
const { WorkflowDO } = await import("../src/do/workflow-do.js");

function createMockCtx() {
	const rows = new Map<string, { id: string; snapshot: string; version: number }>();
	const websockets: unknown[] = [];

	return {
		storage: {
			sql: {
				exec(query: string, ...bindings: unknown[]) {
					if (query.includes("CREATE TABLE")) return { toArray: () => [], rowsWritten: 0 };
					if (query.trimStart().startsWith("SELECT")) {
						const id = bindings[0] as string;
						const row = rows.get(id);
						return {
							toArray: () => (row ? [{ snapshot: row.snapshot, version: row.version }] : []),
							rowsWritten: 0,
						};
					}
					if (query.trimStart().startsWith("INSERT")) {
						const [id, snapshot, version] = bindings as [string, string, number];
						if (rows.has(id)) throw new Error("UNIQUE constraint failed");
						rows.set(id, { id, snapshot, version });
						return { toArray: () => [], rowsWritten: 1 };
					}
					if (query.trimStart().startsWith("UPDATE")) {
						const [snapshot, newVersion, id, expectedVersion] = bindings as [
							string,
							number,
							string,
							number,
						];
						const row = rows.get(id);
						if (!row || row.version !== expectedVersion)
							return { toArray: () => [], rowsWritten: 0 };
						rows.set(id, { id, snapshot, version: newVersion });
						return { toArray: () => [], rowsWritten: 1 };
					}
					return { toArray: () => [], rowsWritten: 0 };
				},
			},
		},
		acceptWebSocket: vi.fn((ws: unknown) => websockets.push(ws)),
		getWebSockets: vi.fn(() => [...websockets]),
	};
}

function createMockRouter() {
	const definition = {
		name: "test",
		createWorkflow: vi.fn((id: string, init: { initialState: string; data: unknown }) => ({
			id,
			state: init.initialState,
			data: init.data,
			events: [],
		})),
		snapshot: vi.fn((workflow: unknown) => {
			const w = workflow as Record<string, unknown>;
			return {
				id: w.id,
				definitionName: "test",
				state: w.state,
				data: w.data,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
			};
		}),
		restore: vi.fn((snapshot: Record<string, unknown>) => ({
			ok: true as const,
			workflow: {
				id: snapshot.id,
				state: snapshot.state,
				data: snapshot.data,
				events: [],
			},
		})),
	};

	return {
		definition,
		dispatch: vi.fn().mockResolvedValue({
			ok: true,
			workflow: {
				id: "wf-1",
				state: "Updated",
				data: { changed: true },
				events: [],
			},
			events: [],
		}),
	};
}

describe("WorkflowDO", () => {
	test("PUT /create creates a workflow and returns snapshot", async () => {
		const ctx = createMockCtx();
		const router = createMockRouter();

		class TestDO extends WorkflowDO {
			routers = [router as never];
		}

		const instance = new TestDO(ctx as never, {});
		const response = await instance.fetch(
			new Request("https://do.internal/create", {
				method: "PUT",
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
				body: JSON.stringify({ initialState: "Draft", data: { items: [] } }),
			}),
		);

		expect(response.status).toBe(201);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.version).toBe(1);
	});

	test("POST /dispatch executes command and returns result", async () => {
		const ctx = createMockCtx();
		const router = createMockRouter();

		class TestDO extends WorkflowDO {
			routers = [router as never];
		}

		const instance = new TestDO(ctx as never, {});

		// First create the workflow
		await instance.fetch(
			new Request("https://do.internal/create", {
				method: "PUT",
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
				body: JSON.stringify({ initialState: "Draft", data: {} }),
			}),
		);

		// Then dispatch
		const response = await instance.fetch(
			new Request("https://do.internal/dispatch", {
				method: "POST",
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
				body: JSON.stringify({ type: "Update", payload: {} }),
			}),
		);

		const body = await response.json();
		expect(body.ok).toBeDefined();
	});

	test("GET /snapshot returns current snapshot", async () => {
		const ctx = createMockCtx();
		const router = createMockRouter();

		class TestDO extends WorkflowDO {
			routers = [router as never];
		}

		const instance = new TestDO(ctx as never, {});

		await instance.fetch(
			new Request("https://do.internal/create", {
				method: "PUT",
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
				body: JSON.stringify({ initialState: "Draft", data: {} }),
			}),
		);

		const response = await instance.fetch(
			new Request("https://do.internal/snapshot", {
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
			}),
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot).toBeDefined();
	});

	test("GET /events returns SSE response", async () => {
		const ctx = createMockCtx();
		const router = createMockRouter();

		class TestDO extends WorkflowDO {
			routers = [router as never];
		}

		const instance = new TestDO(ctx as never, {});
		const response = await instance.fetch(
			new Request("https://do.internal/events", {
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
			}),
		);

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	});

	test("returns 404 for unknown routes", async () => {
		const ctx = createMockCtx();
		const router = createMockRouter();

		class TestDO extends WorkflowDO {
			routers = [router as never];
		}

		const instance = new TestDO(ctx as never, {});
		const response = await instance.fetch(new Request("https://do.internal/unknown"));

		expect(response.status).toBe(404);
	});

	test("returns 500 with error for duplicate router names", async () => {
		const ctx = createMockCtx();
		const router1 = createMockRouter();
		const router2 = createMockRouter();

		class TestDO extends WorkflowDO {
			routers = [router1 as never, router2 as never];
		}

		const response = await new TestDO(ctx as never, {}).fetch(
			new Request("https://do.internal/snapshot", {
				headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
			}),
		);

		expect(response.status).toBe(500);
		const body = (await response.json()) as { ok: boolean; error: { message: string } };
		expect(body.ok).toBe(false);
		expect(body.error.message).toContain("Duplicate router name");
	});
});
