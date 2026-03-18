# Cloudflare Adapters Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@rytejs/cloudflare` package with Durable Object adapters for store, lock, and broadcast, plus a `wsUpdateTransport` in `@rytejs/sync`, enabling the fullstack sync example to run on Cloudflare Workers.

**Architecture:** One Durable Object per workflow provides single-threaded locking, SQLite-backed snapshot storage, and WebSocket + SSE broadcast. A `WorkflowDO` base class composes all adapters with the `ExecutionEngine`. A `routeToDO` helper routes incoming requests to the correct DO instance by parsing `/:routerName/:workflowId/*` from the URL.

**Tech Stack:** Cloudflare Workers, Durable Objects (SQLite backend), TypeScript, Vitest, tsup, Hono

**Spec:** `docs/superpowers/specs/2026-03-18-cloudflare-adapters-design.md`

---

## File Structure

```
packages/cloudflare/
  src/
    adapters/
      store.ts              # cloudflareStore(storage) → StoreAdapter
      lock.ts               # cloudflareLock() → LockAdapter (no-op)
      broadcaster.ts        # cloudflareBroadcaster(ctx) → WS + SSE broadcast manager
    do/
      workflow-do.ts        # WorkflowDO abstract base class
    helpers/
      route-to-do.ts        # routeToDO(req, env, binding) → routes to correct DO
    index.ts                # public exports
  __tests__/
    lock.test.ts
    store.test.ts
    broadcaster.test.ts
    route-to-do.test.ts
    workflow-do.test.ts
  package.json
  tsconfig.json
  tsup.config.ts

packages/sync/
  src/
    transports/
      ws-update.ts          # wsUpdateTransport (new file)
    index.ts                # add wsUpdateTransport export
  __tests__/
    ws-update.test.ts       # new test file

examples/cloudflare-order-dashboard/
  src/
    workflow.ts             # shared order workflow definition
    App.tsx                 # React client (reuse from fullstack example)
    main.tsx                # React entry
  worker.ts                 # Worker entry + OrderDO class
  wrangler.toml
  package.json
  tsconfig.json
  vite.config.ts
```

---

## Task 1: Package Scaffolding

Scaffold the `@rytejs/cloudflare` package with build config, types, and empty index.

**Files:**
- Create: `packages/cloudflare/package.json`
- Create: `packages/cloudflare/tsconfig.json`
- Create: `packages/cloudflare/tsup.config.ts`
- Create: `packages/cloudflare/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
	"name": "@rytejs/cloudflare",
	"version": "0.1.0",
	"description": "Cloudflare Workers adapters for @rytejs workflows",
	"type": "module",
	"sideEffects": false,
	"engines": {
		"node": ">=18"
	},
	"files": [
		"dist"
	],
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js",
			"require": "./dist/index.cjs"
		}
	},
	"scripts": {
		"build": "tsup",
		"test": "vitest run",
		"test:watch": "vitest",
		"typecheck": "tsc --noEmit"
	},
	"peerDependencies": {
		"@rytejs/core": "workspace:^",
		"@rytejs/sync": "workspace:^"
	},
	"devDependencies": {
		"@cloudflare/workers-types": "^4.0.0",
		"@rytejs/core": "workspace:^",
		"@rytejs/sync": "workspace:^",
		"tsup": "^8.4.0",
		"typescript": "^5.7.0",
		"vitest": "^3.0.0"
	}
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"declaration": true,
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"outDir": "dist",
		"rootDir": "src",
		"types": ["@cloudflare/workers-types"]
	},
	"include": ["src"]
}
```

- [ ] **Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

- [ ] **Step 4: Create empty src/index.ts**

```typescript
// @rytejs/cloudflare — Cloudflare Workers adapters
// Exports will be added as adapters are implemented.
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: lockfile updates, packages linked

- [ ] **Step 6: Verify build works**

Run: `pnpm --filter @rytejs/cloudflare build`
Expected: dist/ created with index.js, index.cjs, index.d.ts

- [ ] **Step 7: Commit**

```bash
git add packages/cloudflare/
git commit -m "feat(cloudflare): scaffold @rytejs/cloudflare package"
git push
```

---

## Task 2: cloudflareLock Adapter

No-op lock adapter — the simplest adapter. DO's single-threaded model provides mutual exclusion.

**Files:**
- Create: `packages/cloudflare/src/adapters/lock.ts`
- Create: `packages/cloudflare/__tests__/lock.test.ts`
- Modify: `packages/cloudflare/src/index.ts`

- [ ] **Step 1: Write the failing test**

File: `packages/cloudflare/__tests__/lock.test.ts`

```typescript
import { describe, expect, test } from "vitest";
import { cloudflareLock } from "../src/adapters/lock.js";

describe("cloudflareLock", () => {
	test("acquire always returns true", async () => {
		const lock = cloudflareLock();
		expect(await lock.acquire("wf-1")).toBe(true);
		expect(await lock.acquire("wf-1")).toBe(true);
		expect(await lock.acquire("wf-2")).toBe(true);
	});

	test("release is a no-op that resolves", async () => {
		const lock = cloudflareLock();
		await expect(lock.release("wf-1")).resolves.toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/lock.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

File: `packages/cloudflare/src/adapters/lock.ts`

```typescript
import type { LockAdapter } from "@rytejs/core/engine";

export function cloudflareLock(): LockAdapter {
	return {
		async acquire() {
			return true;
		},
		async release() {},
	};
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/cloudflare/src/index.ts`:

```typescript
export { cloudflareLock } from "./adapters/lock.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/lock.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cloudflare/src/adapters/lock.ts packages/cloudflare/__tests__/lock.test.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add no-op cloudflareLock adapter"
git push
```

---

## Task 3: cloudflareStore Adapter

SQLite-backed store adapter using Durable Object storage. Implements `StoreAdapter` with optimistic concurrency via version checks.

**Files:**
- Create: `packages/cloudflare/src/adapters/store.ts`
- Create: `packages/cloudflare/__tests__/store.test.ts`
- Modify: `packages/cloudflare/src/index.ts`

**Key reference:** `packages/core/src/engine/memory-store.ts` — follow the same `SaveOptions` contract. `expectedVersion` of 0 means new workflow; the store computes `version = expectedVersion + 1` on save.

- [ ] **Step 1: Write the failing tests**

File: `packages/cloudflare/__tests__/store.test.ts`

The tests use a mock `DurableObjectStorage` that simulates the DO SQLite API (`storage.sql.exec()`). The mock tracks rows in a `Map` and interprets queries based on the SQL prefix.

```typescript
import { ConcurrencyConflictError } from "@rytejs/core/engine";
import { describe, expect, test } from "vitest";
import { cloudflareStore } from "../src/adapters/store.js";

/** Mock DurableObjectStorage with an in-memory SQL backend */
function createMockStorage() {
	const rows = new Map<string, { id: string; snapshot: string; version: number }>();

	return {
		sql: {
			exec(query: string, ...bindings: unknown[]) {
				if (query.includes("CREATE TABLE")) {
					return { toArray: () => [], rowsWritten: 0 };
				}
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
					if (rows.has(id)) throw new Error("UNIQUE constraint failed: workflows.id");
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
					if (!row || row.version !== expectedVersion) {
						return { toArray: () => [], rowsWritten: 0 };
					}
					rows.set(id, { id, snapshot, version: newVersion });
					return { toArray: () => [], rowsWritten: 1 };
				}
				return { toArray: () => [], rowsWritten: 0 };
			},
		},
	};
}

describe("cloudflareStore", () => {
	test("load returns null for non-existent workflow", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		expect(await store.load("missing")).toBeNull();
	});

	test("save creates new workflow with expectedVersion 0", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot = { id: "wf-1", state: "Draft", data: {}, definitionName: "order", createdAt: "", updatedAt: "", modelVersion: 1 };

		await store.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 0 });
		const loaded = await store.load("wf-1");

		expect(loaded).not.toBeNull();
		expect(loaded!.version).toBe(1);
		expect(loaded!.snapshot).toEqual(snapshot);
	});

	test("save updates existing workflow with correct expectedVersion", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot1 = { id: "wf-1", state: "Draft", data: {}, definitionName: "order", createdAt: "", updatedAt: "", modelVersion: 1 };
		const snapshot2 = { ...snapshot1, state: "Submitted" };

		await store.save({ id: "wf-1", snapshot: snapshot1 as never, expectedVersion: 0 });
		await store.save({ id: "wf-1", snapshot: snapshot2 as never, expectedVersion: 1 });
		const loaded = await store.load("wf-1");

		expect(loaded!.version).toBe(2);
		expect(loaded!.snapshot).toEqual(snapshot2);
	});

	test("save throws ConcurrencyConflictError on version mismatch", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot = { id: "wf-1", state: "Draft", data: {}, definitionName: "order", createdAt: "", updatedAt: "", modelVersion: 1 };

		await store.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 0 });

		const err = await store
			.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 0 })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ConcurrencyConflictError);
		expect((err as ConcurrencyConflictError).expectedVersion).toBe(0);
		expect((err as ConcurrencyConflictError).actualVersion).toBe(1);
	});

	test("save throws ConcurrencyConflictError when updating non-existent workflow", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot = { id: "wf-1", state: "Draft", data: {}, definitionName: "order", createdAt: "", updatedAt: "", modelVersion: 1 };

		await expect(
			store.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 5 }),
		).rejects.toThrow(ConcurrencyConflictError);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

File: `packages/cloudflare/src/adapters/store.ts`

```typescript
import { ConcurrencyConflictError } from "@rytejs/core/engine";
import type { StoreAdapter } from "@rytejs/core/engine";

export function cloudflareStore(storage: DurableObjectStorage): StoreAdapter {
	storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS workflows (
			id TEXT PRIMARY KEY,
			snapshot TEXT NOT NULL,
			version INTEGER NOT NULL
		)
	`);

	return {
		async load(id) {
			const rows = storage.sql
				.exec("SELECT snapshot, version FROM workflows WHERE id = ?", id)
				.toArray();

			if (rows.length === 0) return null;

			return {
				snapshot: JSON.parse(rows[0].snapshot as string),
				version: rows[0].version as number,
			};
		},

		async save({ id, snapshot, expectedVersion }) {
			const json = JSON.stringify(snapshot);
			const newVersion = expectedVersion + 1;

			if (expectedVersion === 0) {
				try {
					storage.sql.exec(
						"INSERT INTO workflows (id, snapshot, version) VALUES (?, ?, ?)",
						id,
						json,
						newVersion,
					);
				} catch {
					// Row exists — query actual version for the error
					const rows = storage.sql
						.exec("SELECT version FROM workflows WHERE id = ?", id)
						.toArray();
					const actual = rows.length > 0 ? (rows[0].version as number) : -1;
					throw new ConcurrencyConflictError(id, expectedVersion, actual);
				}
				return;
			}

			const cursor = storage.sql.exec(
				"UPDATE workflows SET snapshot = ?, version = ? WHERE id = ? AND version = ?",
				json,
				newVersion,
				id,
				expectedVersion,
			);

			if (cursor.rowsWritten === 0) {
				// Version mismatch — query actual version for the error
				const rows = storage.sql
					.exec("SELECT version FROM workflows WHERE id = ?", id)
					.toArray();
				const actual = rows.length > 0 ? (rows[0].version as number) : 0;
				throw new ConcurrencyConflictError(id, expectedVersion, actual);
			}
		},
	};
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/cloudflare/src/index.ts`:

```typescript
export { cloudflareStore } from "./adapters/store.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/store.test.ts`
Expected: 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cloudflare/src/adapters/store.ts packages/cloudflare/__tests__/store.test.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add SQLite-backed cloudflareStore adapter"
git push
```

---

## Task 4: cloudflareBroadcaster Adapter

Manages both WebSocket (via hibernatable API) and SSE connections. Lower-level primitive than `@rytejs/sync/server`'s `Broadcaster` — it only handles connections and broadcast, not engine execution.

**Files:**
- Create: `packages/cloudflare/src/adapters/broadcaster.ts`
- Create: `packages/cloudflare/__tests__/broadcaster.test.ts`
- Modify: `packages/cloudflare/src/index.ts`

**Key reference:** `packages/sync/src/server/broadcaster.ts` — similar SSE pattern, but this also handles WebSocket via `ctx.acceptWebSocket()` / `ctx.getWebSockets()`.

- [ ] **Step 1: Write the failing tests**

File: `packages/cloudflare/__tests__/broadcaster.test.ts`

The broadcaster's `handleWebSocket` accepts a server-side `WebSocket` and registers it via `ctx.acceptWebSocket()`. The `WorkflowDO` is responsible for creating the `WebSocketPair` and passing the server socket. This keeps the broadcaster testable without mocking the `WebSocketPair` global.

```typescript
import { describe, expect, test, vi } from "vitest";
import { cloudflareBroadcaster } from "../src/adapters/broadcaster.js";

function createMockCtx() {
	const websockets: Array<{ send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> =
		[];
	return {
		acceptWebSocket(ws: unknown) {
			websockets.push(ws as (typeof websockets)[number]);
		},
		getWebSockets() {
			return [...websockets];
		},
		_websockets: websockets,
	};
}

describe("cloudflareBroadcaster", () => {
	test("handleSSE returns SSE response with correct headers", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const response = broadcaster.handleSSE();

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});

	test("broadcast sends to SSE clients", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const response = broadcaster.handleSSE();
		const reader = response.body!.getReader();

		const update = { snapshot: { id: "wf-1", state: "Draft" } as never, version: 2 };
		broadcaster.broadcast(update);

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain(`data: ${JSON.stringify(update)}`);
		reader.cancel();
	});

	test("handleWebSocket registers websocket via ctx.acceptWebSocket", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const mockWs = { send: vi.fn(), close: vi.fn() };

		broadcaster.handleWebSocket(mockWs as never);
		expect(ctx._websockets).toContain(mockWs);
	});

	test("broadcast sends to WebSocket clients", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const mockWs = { send: vi.fn(), close: vi.fn() };

		broadcaster.handleWebSocket(mockWs as never);
		const update = { snapshot: { id: "wf-1", state: "Draft" } as never, version: 2 };
		broadcaster.broadcast(update);

		expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(update));
	});

	test("broadcast sends to both SSE and WebSocket clients", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		const sseResponse = broadcaster.handleSSE();
		const reader = sseResponse.body!.getReader();

		const mockWs = { send: vi.fn(), close: vi.fn() };
		broadcaster.handleWebSocket(mockWs as never);

		const update = { snapshot: { id: "wf-1", state: "Draft" } as never, version: 3 };
		broadcaster.broadcast(update);

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain(`data: ${JSON.stringify(update)}`);
		expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(update));
		reader.cancel();
	});

	test("connectionCount counts SSE and WebSocket clients", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		expect(broadcaster.connectionCount()).toBe(0);

		broadcaster.handleSSE();
		expect(broadcaster.connectionCount()).toBe(1);

		broadcaster.handleWebSocket({ send: vi.fn(), close: vi.fn() } as never);
		expect(broadcaster.connectionCount()).toBe(2);
	});

	test("close closes all SSE controllers and WebSocket connections", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		broadcaster.handleSSE();
		const mockWs = { send: vi.fn(), close: vi.fn() };
		broadcaster.handleWebSocket(mockWs as never);

		expect(broadcaster.connectionCount()).toBe(2);
		broadcaster.close();

		expect(mockWs.close).toHaveBeenCalledWith(1000, "closing");
		// SSE controllers are cleared
		expect(broadcaster.connectionCount()).toBe(0);
	});

	test("SSE stream cancel cleans up controller", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		const response = broadcaster.handleSSE();
		expect(broadcaster.connectionCount()).toBe(1);

		await response.body!.cancel();
		await new Promise((r) => setTimeout(r, 10));
		// Only WS count remains (0 since no WS connected)
		// SSE count decremented
		expect(broadcaster.connectionCount()).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/broadcaster.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

File: `packages/cloudflare/src/adapters/broadcaster.ts`

```typescript
import type { UpdateMessage } from "@rytejs/sync";

export interface CloudflareBroadcaster {
	/** Register a server-side WebSocket. The caller creates the WebSocketPair. */
	handleWebSocket(server: WebSocket): void;
	/** Create and return an SSE ReadableStream response. */
	handleSSE(): Response;
	/** Broadcast an update to all connected WS + SSE clients. */
	broadcast(update: UpdateMessage): void;
	/** Count of active connections (WS + SSE). */
	connectionCount(): number;
	/** Close all connections. */
	close(): void;
}

function formatSSE(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export function cloudflareBroadcaster(ctx: DurableObjectState): CloudflareBroadcaster {
	const sseControllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const encoder = new TextEncoder();

	return {
		handleWebSocket(server) {
			ctx.acceptWebSocket(server);
		},

		handleSSE() {
			let controller: ReadableStreamDefaultController<Uint8Array>;

			const stream = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
					sseControllers.add(c);
				},
				cancel() {
					sseControllers.delete(controller);
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			});
		},

		broadcast(update) {
			const encoded = encoder.encode(formatSSE(update));

			// Send to SSE clients
			for (const controller of sseControllers) {
				try {
					controller.enqueue(encoded);
				} catch {
					// Controller may be closed
				}
			}

			// Send to WebSocket clients (hibernatable API)
			const websockets = ctx.getWebSockets();
			const json = JSON.stringify(update);
			for (const ws of websockets) {
				try {
					ws.send(json);
				} catch {
					// WebSocket may be closed
				}
			}
		},

		connectionCount() {
			return sseControllers.size + ctx.getWebSockets().length;
		},

		close() {
			// Close SSE controllers
			for (const controller of sseControllers) {
				try {
					controller.close();
				} catch {
					// Already closed
				}
			}
			sseControllers.clear();

			// Close WebSocket connections
			for (const ws of ctx.getWebSockets()) {
				try {
					ws.close(1000, "closing");
				} catch {
					// Already closed
				}
			}
		},
	};
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/cloudflare/src/index.ts`:

```typescript
export { type CloudflareBroadcaster, cloudflareBroadcaster } from "./adapters/broadcaster.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/broadcaster.test.ts`
Expected: 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cloudflare/src/adapters/broadcaster.ts packages/cloudflare/__tests__/broadcaster.test.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add cloudflareBroadcaster with WS + SSE support"
git push
```

---

## Task 5: routeToDO Helper

Parses `/:routerName/:workflowId/*` from the URL, generates a deterministic DO ID, forwards the request with an `X-Router-Name` header.

**Files:**
- Create: `packages/cloudflare/src/helpers/route-to-do.ts`
- Create: `packages/cloudflare/__tests__/route-to-do.test.ts`
- Modify: `packages/cloudflare/src/index.ts`

- [ ] **Step 1: Write the failing tests**

File: `packages/cloudflare/__tests__/route-to-do.test.ts`

```typescript
import { describe, expect, test, vi } from "vitest";
import { routeToDO } from "../src/helpers/route-to-do.js";

function createMockEnv(binding: string) {
	const fetches: Array<{ id: string; request: Request }> = [];

	return {
		env: {
			[binding]: {
				idFromName(name: string) {
					return { name };
				},
				get(id: { name: string }) {
					return {
						fetch(request: Request) {
							fetches.push({ id: id.name, request });
							return Promise.resolve(new Response("ok"));
						},
					};
				},
			},
		},
		fetches,
	};
}

describe("routeToDO", () => {
	test("routes POST /:router/:id/dispatch to correct DO", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-123/dispatch", {
			method: "POST",
			body: JSON.stringify({ type: "Submit", payload: {} }),
		});

		await routeToDO(request, env as never, "WORKFLOW_DO");

		expect(fetches).toHaveLength(1);
		expect(fetches[0].id).toBe("order:wf-123");
		expect(fetches[0].request.method).toBe("POST");
		expect(new URL(fetches[0].request.url).pathname).toBe("/dispatch");
		expect(fetches[0].request.headers.get("X-Router-Name")).toBe("order");
	});

	test("routes GET /:router/:id/events to correct DO", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-123/events");

		await routeToDO(request, env as never, "WORKFLOW_DO");

		expect(fetches[0].id).toBe("order:wf-123");
		expect(new URL(fetches[0].request.url).pathname).toBe("/events");
		expect(fetches[0].request.headers.get("X-Router-Name")).toBe("order");
	});

	test("routes PUT /:router/:id/create to correct DO", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-456/create", {
			method: "PUT",
			body: JSON.stringify({ initialState: "Draft", data: {} }),
		});

		await routeToDO(request, env as never, "WORKFLOW_DO");

		expect(fetches[0].id).toBe("order:wf-456");
		expect(new URL(fetches[0].request.url).pathname).toBe("/create");
	});

	test("returns 400 for URLs with fewer than 2 path segments", async () => {
		const { env } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order");

		const response = await routeToDO(request, env as never, "WORKFLOW_DO");
		expect(response.status).toBe(400);
	});

	test("preserves query parameters", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-1/snapshot?format=full");

		await routeToDO(request, env as never, "WORKFLOW_DO");

		const forwardedUrl = new URL(fetches[0].request.url);
		expect(forwardedUrl.pathname).toBe("/snapshot");
		expect(forwardedUrl.searchParams.get("format")).toBe("full");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/route-to-do.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

File: `packages/cloudflare/src/helpers/route-to-do.ts`

```typescript
export async function routeToDO(
	request: Request,
	env: Record<string, DurableObjectNamespace>,
	binding: string,
): Promise<Response> {
	const url = new URL(request.url);
	const segments = url.pathname.split("/").filter(Boolean);

	if (segments.length < 2) {
		return new Response(
			JSON.stringify({ ok: false, error: { category: "router", message: "Invalid URL: expected /:routerName/:workflowId/..." } }),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}

	const [routerName, workflowId, ...rest] = segments;
	const remainingPath = `/${rest.join("/")}`;
	const doId = env[binding].idFromName(`${routerName}:${workflowId}`);
	const stub = env[binding].get(doId);

	const forwardUrl = new URL(remainingPath, url.origin);
	forwardUrl.search = url.search;

	const forwardRequest = new Request(forwardUrl.toString(), {
		method: request.method,
		headers: request.headers,
		body: request.body,
		// @ts-expect-error -- duplex is needed for streaming bodies in some runtimes
		duplex: "half",
	});
	forwardRequest.headers.set("X-Router-Name", routerName);
	forwardRequest.headers.set("X-Workflow-Id", workflowId);

	return stub.fetch(forwardRequest);
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/cloudflare/src/index.ts`:

```typescript
export { routeToDO } from "./helpers/route-to-do.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/route-to-do.test.ts`
Expected: 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cloudflare/src/helpers/route-to-do.ts packages/cloudflare/__tests__/route-to-do.test.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add routeToDO helper for DO routing"
git push
```

---

## Task 6: WorkflowDO Base Class

Abstract base class that composes all adapters with `ExecutionEngine`. Uses lazy initialization to work around the class field timing issue (subclass fields aren't available in the base constructor).

**Files:**
- Create: `packages/cloudflare/src/do/workflow-do.ts`
- Create: `packages/cloudflare/__tests__/workflow-do.test.ts`
- Modify: `packages/cloudflare/src/index.ts`

**Key reference:** `packages/core/src/engine/engine.ts:57-94` for `create()`, `packages/core/src/engine/engine.ts:96-169` for `execute()`.

- [ ] **Step 1: Write the failing tests**

File: `packages/cloudflare/__tests__/workflow-do.test.ts`

Since `DurableObject` is a Cloudflare global, the test mocks it. The test creates a concrete subclass and exercises the DO's `fetch()` routing.

```typescript
import { describe, expect, test, vi, beforeAll } from "vitest";

// Mock Cloudflare's DurableObject base class
beforeAll(() => {
	globalThis.DurableObject = class {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	} as never;
});

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
						const [snapshot, newVersion, id, expectedVersion] = bindings as [string, number, string, number];
						const row = rows.get(id);
						if (!row || row.version !== expectedVersion) return { toArray: () => [], rowsWritten: 0 };
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

// Create a mock router for testing
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
			workflow: { id: snapshot.id, state: snapshot.state, data: snapshot.data, events: [] },
		})),
	};

	return {
		definition,
		dispatch: vi.fn().mockResolvedValue({
			ok: true,
			workflow: { id: "wf-1", state: "Updated", data: { changed: true }, events: [] },
			events: [],
		}),
	};
}

describe("WorkflowDO", () => {
	test("PUT /create creates a workflow and returns snapshot", async () => {
		const ctx = createMockCtx();
		const router = createMockRouter();

		class TestDO extends WorkflowDO {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			routers = [router as any];
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
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			routers = [router as any];
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
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			routers = [router as any];
		}

		const instance = new TestDO(ctx as never, {});

		// Create first
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
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			routers = [router as any];
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
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			routers = [router as any];
		}

		const instance = new TestDO(ctx as never, {});
		const response = await instance.fetch(new Request("https://do.internal/unknown"));

		expect(response.status).toBe(404);
	});

	test("throws on duplicate router names", () => {
		const ctx = createMockCtx();
		const router1 = createMockRouter();
		const router2 = createMockRouter(); // Same definition.name = "test"

		class TestDO extends WorkflowDO {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			routers = [router1 as any, router2 as any];
		}

		// Lazy init happens on first fetch
		expect(
			new TestDO(ctx as never, {}).fetch(
				new Request("https://do.internal/snapshot", {
					headers: { "X-Router-Name": "test", "X-Workflow-Id": "wf-1" },
				}),
			),
		).rejects.toThrow("Duplicate router name");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/workflow-do.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

File: `packages/cloudflare/src/do/workflow-do.ts`

```typescript
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
			if (request.method === "PUT" && path === "/create") {
				return await this.handleCreate(routerName, workflowId, request);
			}
			if (request.method === "POST" && path === "/dispatch") {
				return await this.handleDispatch(routerName, workflowId, request);
			}
			if (request.method === "GET" && path === "/events") {
				return this.broadcaster.handleSSE();
			}
			if (request.method === "GET" && path === "/websocket") {
				return this.handleWebSocket(request);
			}
			if (request.method === "GET" && path === "/snapshot") {
				return await this.handleSnapshot(workflowId);
			}

			return this.jsonResponse({ ok: false, error: { category: "router", message: "Not found" } }, 404);
		} catch (err) {
			return this.handleError(err);
		}
	}

	webSocketClose(ws: WebSocket) {
		// Hibernatable WS cleanup — handled automatically by ctx.getWebSockets()
	}

	webSocketError(ws: WebSocket) {
		// Hibernatable WS cleanup — handled automatically by ctx.getWebSockets()
	}

	private async handleCreate(routerName: string, workflowId: string, request: Request): Promise<Response> {
		const body = (await request.json()) as { initialState: string; data: unknown };
		const result = await this.engine.create(routerName, workflowId, {
			initialState: body.initialState,
			data: body.data,
		});
		return this.jsonResponse({ ok: true, snapshot: result.workflow, version: result.version }, 201);
	}

	private async handleDispatch(routerName: string, workflowId: string, request: Request): Promise<Response> {
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
		const status = error.category === "validation" ? 422
			: error.category === "domain" ? 422
			: 500;
		return this.jsonResponse({ ok: false, error }, status);
	}

	private async handleSnapshot(workflowId: string): Promise<Response> {
		const stored = await this.engine.load(workflowId);
		if (!stored) {
			return this.jsonResponse({ ok: false, error: { category: "not_found", message: "Workflow not found" } }, 404);
		}
		return this.jsonResponse({ ok: true, snapshot: stored.snapshot, version: stored.version });
	}

	private handleWebSocket(request: Request): Response {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.broadcaster.handleWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	private handleError(err: unknown): Response {
		if (err instanceof WorkflowNotFoundError) {
			return this.jsonResponse({ ok: false, error: { category: "not_found", message: err.message } }, 404);
		}
		if (err instanceof WorkflowAlreadyExistsError || err instanceof ConcurrencyConflictError) {
			return this.jsonResponse({ ok: false, error: { category: "conflict", message: err.message } }, 409);
		}
		if (err instanceof LockConflictError) {
			return this.jsonResponse({ ok: false, error: { category: "locked", message: err.message } }, 409);
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
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/cloudflare/src/index.ts`:

```typescript
export { WorkflowDO } from "./do/workflow-do.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/cloudflare vitest run __tests__/workflow-do.test.ts`
Expected: 6 tests PASS

- [ ] **Step 6: Run all cloudflare tests**

Run: `pnpm --filter @rytejs/cloudflare vitest run`
Expected: All tests PASS (lock + store + broadcaster + route-to-do + workflow-do)

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @rytejs/cloudflare tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/cloudflare/src/do/workflow-do.ts packages/cloudflare/__tests__/workflow-do.test.ts packages/cloudflare/src/index.ts
git commit -m "feat(cloudflare): add WorkflowDO base class"
git push
```

---

## Task 7: wsUpdateTransport (in @rytejs/sync)

Client-side WebSocket transport implementing `UpdateTransport`. Not Cloudflare-specific — works with any WebSocket server.

**Files:**
- Create: `packages/sync/src/transports/ws-update.ts`
- Create: `packages/sync/__tests__/ws-update.test.ts`
- Modify: `packages/sync/src/index.ts`

**Key reference:** `packages/sync/src/transports/sse-update.ts` — mirror the reconnection pattern and options shape.

- [ ] **Step 1: Write the failing tests**

File: `packages/sync/__tests__/ws-update.test.ts`

```typescript
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { UpdateMessage } from "../src/types.js";

/** Mock WebSocket that captures sent messages and allows simulating events */
class MockWebSocket {
	url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	closed = false;

	constructor(url: string) {
		this.url = url;
		// Auto-open on next tick (matches real WebSocket behavior)
		setTimeout(() => this.onopen?.(), 0);
	}

	close() {
		this.closed = true;
		this.onclose?.();
	}

	_receiveMessage(data: string) {
		this.onmessage?.({ data });
	}

	_error() {
		this.onerror?.({});
		// In real browsers, onerror is always followed by onclose
		this.onclose?.();
	}
}

let mockInstances: MockWebSocket[];

beforeEach(() => {
	mockInstances = [];
	vi.stubGlobal(
		"WebSocket",
		class extends MockWebSocket {
			constructor(url: string) {
				super(url);
				mockInstances.push(this);
			}
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Dynamic import so the module picks up the mocked global
const { wsUpdateTransport } = await import("../src/transports/ws-update.js");

describe("wsUpdateTransport", () => {
	test("subscribe opens WebSocket to correct URL", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost:3000/api", router: "order" });

		transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		expect(mockInstances).toHaveLength(1);
		expect(mockInstances[0].url).toBe("ws://localhost:3000/api/order/wf-1/websocket");
	});

	test("converts https to wss", async () => {
		const transport = wsUpdateTransport({ url: "https://example.com/api", router: "order" });

		transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		expect(mockInstances[0].url).toBe("wss://example.com/api/order/wf-1/websocket");
	});

	test("calls listener on incoming message", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost/api", router: "order" });
		const listener = vi.fn();

		transport.subscribe("wf-1", listener);
		await new Promise((r) => setTimeout(r, 10));

		const update: UpdateMessage = {
			snapshot: { id: "wf-1", state: "Draft" } as never,
			version: 2,
		};
		mockInstances[0]._receiveMessage(JSON.stringify(update));

		expect(listener).toHaveBeenCalledWith(update);
	});

	test("unsubscribe closes the WebSocket", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost/api", router: "order" });

		const sub = transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		sub.unsubscribe();
		expect(mockInstances[0].closed).toBe(true);
	});

	test("reconnects on error after delay", async () => {
		const transport = wsUpdateTransport({
			url: "http://localhost/api",
			router: "order",
			reconnectDelay: 50,
		});

		transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));
		expect(mockInstances).toHaveLength(1);

		// Simulate error
		mockInstances[0]._error();
		await new Promise((r) => setTimeout(r, 100));

		expect(mockInstances).toHaveLength(2);
	});

	test("does not reconnect after unsubscribe", async () => {
		const transport = wsUpdateTransport({
			url: "http://localhost/api",
			router: "order",
			reconnectDelay: 50,
		});

		const sub = transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		sub.unsubscribe();
		mockInstances[0]._error();
		await new Promise((r) => setTimeout(r, 100));

		// Should still only be 1 instance (no reconnect)
		expect(mockInstances).toHaveLength(1);
	});

	test("skips malformed messages", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost/api", router: "order" });
		const listener = vi.fn();

		transport.subscribe("wf-1", listener);
		await new Promise((r) => setTimeout(r, 10));

		mockInstances[0]._receiveMessage("not json");
		expect(listener).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/ws-update.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

File: `packages/sync/src/transports/ws-update.ts`

```typescript
import type { Subscription, UpdateMessage, UpdateTransport } from "../types.js";

export interface WsUpdateOptions {
	/** Base URL for WebSocket endpoint */
	url: string;
	/** Router name for URL construction */
	router: string;
	/** Reconnect delay in ms after connection drop. Default: 1000 */
	reconnectDelay?: number;
}

function toWsUrl(url: string): string {
	return url.replace(/^http/, "ws");
}

export function wsUpdateTransport(options: WsUpdateOptions): UpdateTransport {
	const { url, router, reconnectDelay = 1000 } = options;

	return {
		subscribe(workflowId: string, listener: (message: UpdateMessage) => void): Subscription {
			let stopped = false;
			let ws: WebSocket | null = null;

			function connect() {
				if (stopped) return;

				const wsUrl = `${toWsUrl(url)}/${router}/${workflowId}/websocket`;
				ws = new WebSocket(wsUrl);

				ws.onmessage = (event: MessageEvent) => {
					try {
						const message = JSON.parse(event.data as string) as UpdateMessage;
						listener(message);
					} catch {
						// Skip malformed messages
					}
				};

				ws.onerror = () => {
					// onerror is always followed by onclose — reconnect there
				};

				ws.onclose = () => {
					if (!stopped) {
						setTimeout(connect, reconnectDelay);
					}
				};
			}

			connect();

			return {
				unsubscribe() {
					stopped = true;
					ws?.close();
				},
			};
		},
	};
}
```

- [ ] **Step 4: Export from sync index.ts**

Add to `packages/sync/src/index.ts`:

```typescript
export { type WsUpdateOptions, wsUpdateTransport } from "./transports/ws-update.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/ws-update.test.ts`
Expected: 7 tests PASS

- [ ] **Step 6: Run all sync tests to ensure no regressions**

Run: `pnpm --filter @rytejs/sync vitest run`
Expected: All tests PASS (existing broadcaster + transport tests + new ws-update tests)

- [ ] **Step 7: Commit**

```bash
git add packages/sync/src/transports/ws-update.ts packages/sync/__tests__/ws-update.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): add wsUpdateTransport for WebSocket-based updates"
git push
```

---

## Task 8: Cloudflare Order Dashboard Example

Port the fullstack order dashboard to Cloudflare Workers. Reuses the same shared workflow definition and React client, but replaces the Node.js Hono server with a Worker + Durable Object.

**Files:**
- Create: `examples/cloudflare-order-dashboard/worker.ts`
- Create: `examples/cloudflare-order-dashboard/src/workflow.ts`
- Create: `examples/cloudflare-order-dashboard/wrangler.toml`
- Create: `examples/cloudflare-order-dashboard/package.json`
- Create: `examples/cloudflare-order-dashboard/tsconfig.json`

**Key reference:** `examples/fullstack-order-dashboard/` — the existing example to port from.

- [ ] **Step 1: Create package.json**

File: `examples/cloudflare-order-dashboard/package.json`

```json
{
	"name": "@rytejs/example-cloudflare-order-dashboard",
	"private": true,
	"type": "module",
	"scripts": {
		"dev": "wrangler dev",
		"deploy": "wrangler deploy"
	},
	"dependencies": {
		"@rytejs/cloudflare": "workspace:*",
		"@rytejs/core": "workspace:*",
		"@rytejs/sync": "workspace:*",
		"zod": "^4.0.0"
	},
	"devDependencies": {
		"@cloudflare/workers-types": "^4.0.0",
		"typescript": "^5.7.0",
		"wrangler": "^4.0.0"
	}
}
```

- [ ] **Step 2: Create tsconfig.json**

File: `examples/cloudflare-order-dashboard/tsconfig.json`

```json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"types": ["@cloudflare/workers-types"]
	},
	"include": ["*.ts", "src/**/*.ts"]
}
```

- [ ] **Step 3: Create wrangler.toml**

File: `examples/cloudflare-order-dashboard/wrangler.toml`

```toml
name = "ryte-order-dashboard"
main = "worker.ts"
compatibility_date = "2025-04-01"

[[durable_objects.bindings]]
name = "WORKFLOW_DO"
class_name = "OrderDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["OrderDO"]
```

- [ ] **Step 4: Create shared workflow definition**

File: `examples/cloudflare-order-dashboard/src/workflow.ts`

Copy from `examples/fullstack-order-dashboard/src/workflow.ts` but remove the React imports (server-only for this example):

```typescript
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

export const itemSchema = z.object({
	name: z.string(),
	quantity: z.number().int().positive(),
	price: z.number().positive(),
});

export type Item = z.infer<typeof itemSchema>;

export const orderDefinition = defineWorkflow("order", {
	states: {
		Draft: z.object({ customer: z.string(), items: z.array(itemSchema) }),
		Submitted: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			submittedAt: z.coerce.date(),
		}),
		Approved: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			approvedBy: z.string(),
		}),
		Paid: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			paidAt: z.coerce.date(),
			transactionId: z.string(),
		}),
		Shipped: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			trackingNumber: z.string(),
			shippedAt: z.coerce.date(),
		}),
		Delivered: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			deliveredAt: z.coerce.date(),
		}),
		Rejected: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			reason: z.string(),
			rejectedAt: z.coerce.date(),
		}),
	},
	commands: {
		AddItem: z.object({
			name: z.string(),
			quantity: z.number().int().positive(),
			price: z.number().positive(),
		}),
		RemoveItem: z.object({ index: z.number().int().min(0) }),
		SetCustomer: z.object({ customer: z.string() }),
		Submit: z.object({}),
		Approve: z.object({ approvedBy: z.string() }),
		Reject: z.object({ reason: z.string() }),
		ProcessPayment: z.object({ transactionId: z.string() }),
		Ship: z.object({ trackingNumber: z.string() }),
		ConfirmDelivery: z.object({}),
		Resubmit: z.object({}),
	},
	events: {
		OrderSubmitted: z.object({ orderId: z.string(), customer: z.string(), itemCount: z.number() }),
		OrderApproved: z.object({ orderId: z.string(), approvedBy: z.string() }),
		OrderRejected: z.object({ orderId: z.string(), reason: z.string() }),
		PaymentProcessed: z.object({
			orderId: z.string(),
			transactionId: z.string(),
			amount: z.number(),
		}),
		OrderShipped: z.object({ orderId: z.string(), trackingNumber: z.string() }),
		OrderDelivered: z.object({ orderId: z.string() }),
	},
	errors: {
		EmptyOrder: z.object({}),
	},
});

export type OrderConfig = typeof orderDefinition.config;
```

- [ ] **Step 5: Create worker entry with router handlers and DO class**

File: `examples/cloudflare-order-dashboard/worker.ts`

```typescript
import { WorkflowRouter } from "@rytejs/core";
import { WorkflowDO, routeToDO } from "@rytejs/cloudflare";
import { orderDefinition } from "./src/workflow.js";
import type { Item } from "./src/workflow.js";

// --- Router with handlers ---

const router = new WorkflowRouter(orderDefinition);

router.state("Draft", ({ on }) => {
	on("AddItem", ({ data, command, update }) => {
		const newItem: Item = {
			name: command.payload.name,
			quantity: command.payload.quantity,
			price: command.payload.price,
		};
		update({ items: [...data.items, newItem] });
	});

	on("RemoveItem", ({ data, command, update }) => {
		const items = data.items.filter((_, i) => i !== command.payload.index);
		update({ items });
	});

	on("SetCustomer", ({ command, update }) => {
		update({ customer: command.payload.customer });
	});

	on("Submit", ({ data, workflow, transition, emit, error }) => {
		if (data.items.length === 0) {
			error({ code: "EmptyOrder", data: {} });
		}
		transition("Submitted", {
			customer: data.customer,
			items: data.items,
			submittedAt: new Date(),
		});
		emit({
			type: "OrderSubmitted",
			data: { orderId: workflow.id, customer: data.customer, itemCount: data.items.length },
		});
	});
});

router.state("Submitted", ({ on }) => {
	on("Approve", ({ data, workflow, command, transition, emit }) => {
		transition("Approved", {
			customer: data.customer,
			items: data.items,
			approvedBy: command.payload.approvedBy,
		});
		emit({
			type: "OrderApproved",
			data: { orderId: workflow.id, approvedBy: command.payload.approvedBy },
		});
	});

	on("Reject", ({ data, workflow, command, transition, emit }) => {
		transition("Rejected", {
			customer: data.customer,
			items: data.items,
			reason: command.payload.reason,
			rejectedAt: new Date(),
		});
		emit({
			type: "OrderRejected",
			data: { orderId: workflow.id, reason: command.payload.reason },
		});
	});
});

router.state("Approved", ({ on }) => {
	on("ProcessPayment", ({ data, workflow, command, transition, emit }) => {
		const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		transition("Paid", {
			customer: data.customer,
			items: data.items,
			paidAt: new Date(),
			transactionId: command.payload.transactionId,
		});
		emit({
			type: "PaymentProcessed",
			data: { orderId: workflow.id, transactionId: command.payload.transactionId, amount: total },
		});
	});
});

router.state("Paid", ({ on }) => {
	on("Ship", ({ data, workflow, command, transition, emit }) => {
		transition("Shipped", {
			customer: data.customer,
			items: data.items,
			trackingNumber: command.payload.trackingNumber,
			shippedAt: new Date(),
		});
		emit({
			type: "OrderShipped",
			data: { orderId: workflow.id, trackingNumber: command.payload.trackingNumber },
		});
	});
});

router.state("Shipped", ({ on }) => {
	on("ConfirmDelivery", ({ data, workflow, transition, emit }) => {
		transition("Delivered", {
			customer: data.customer,
			items: data.items,
			deliveredAt: new Date(),
		});
		emit({
			type: "OrderDelivered",
			data: { orderId: workflow.id },
		});
	});
});

router.state("Rejected", ({ on }) => {
	on("Resubmit", ({ data, transition }) => {
		transition("Draft", {
			customer: data.customer,
			items: data.items,
		});
	});
});

// --- Durable Object ---

export class OrderDO extends WorkflowDO {
	routers = [router];
}

// --- Worker entry ---

export default {
	async fetch(request: Request, env: { WORKFLOW_DO: DurableObjectNamespace }) {
		return routeToDO(request, env as never, "WORKFLOW_DO");
	},
};
```

- [ ] **Step 6: Install dependencies**

Run: `cd /home/ralph/ryte && pnpm install`
Expected: dependencies linked

- [ ] **Step 7: Build @rytejs/cloudflare (needed for example)**

Run: `pnpm --filter @rytejs/cloudflare build`
Expected: dist/ created

- [ ] **Step 8: Verify wrangler can type-check the worker**

Run: `cd examples/cloudflare-order-dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 9: Commit**

```bash
git add examples/cloudflare-order-dashboard/
git commit -m "feat(examples): add Cloudflare order dashboard example"
git push
```

---

## Task 9: Final Verification

Build all packages, run all tests, verify everything works together.

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `pnpm run build`
Expected: All packages build successfully including @rytejs/cloudflare

- [ ] **Step 2: Run all cloudflare tests**

Run: `pnpm --filter @rytejs/cloudflare vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run all sync tests**

Run: `pnpm --filter @rytejs/sync vitest run`
Expected: All tests PASS (including new ws-update tests)

- [ ] **Step 4: Run lint**

Run: `pnpm biome check .`
Expected: No errors (may need `--fix` for import ordering)

- [ ] **Step 5: Run typecheck across workspace**

Run: `pnpm --filter @rytejs/cloudflare tsc --noEmit && pnpm --filter @rytejs/sync tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: fix lint issues in cloudflare adapters"
git push
```
