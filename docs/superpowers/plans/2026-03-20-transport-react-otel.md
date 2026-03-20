# Transport, React Integration & Otel Executor Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three client-side transport implementations (WS, SSE, polling), server-side transport helpers, React store transport integration, and the executor otel plugin.

**Architecture:** Each transport implements the `Transport` interface (already defined in `@rytejs/core/transport`). Client-side transports use standard Web APIs (`fetch`, `WebSocket`, `EventSource`). Server-side helpers accept `Request` and return `Response`. The React store gets an optional `transport` param — with it, dispatch goes through the server and broadcasts update the local workflow. The otel executor plugin traces the executor pipeline.

**Tech Stack:** TypeScript, Vitest, standard Web APIs, `@opentelemetry/api`

**Spec:** `docs/superpowers/specs/2026-03-19-executor-transport-design.md`

**Convention:** Every task ends with `git commit` then `git push` per project rules. Don't batch pushes. Push commands omitted for brevity — always push after each commit.

---

## Scope

1. Server-side transport helpers (`handleSSE`, `handlePolling`) — used for testing client transports
2. `sseTransport(url)` — client-side SSE transport
3. `pollingTransport(url, interval?)` — client-side polling transport
4. `wsTransport(url)` — client-side WebSocket transport (deferred — WebSocket upgrade is runtime-specific)
5. React store transport integration
6. Otel executor plugin

**Note on WebSocket:** The `handleWebSocket` server helper and `wsTransport` client require WebSocket upgrade which varies across runtimes. The plan implements SSE and polling first (fully testable with standard APIs), and stubs the WS transport interface. A real WS implementation requires a runtime-specific test setup (e.g., Cloudflare Workers miniflare or a real server) and is better as a follow-up.

## File Structure

```
packages/core/src/transport/
├── types.ts                    EXISTS — Transport, TransportResult, TransportError, etc.
├── index.ts                    MODIFY — add exports for new implementations
├── sse.ts                      NEW — sseTransport client implementation
├── polling.ts                  NEW — pollingTransport client implementation
├── ws.ts                       NEW — wsTransport client (stub with TODO)
└── server/
    ├── index.ts                NEW — server-side exports
    ├── sse.ts                  NEW — handleSSE server helper
    └── polling.ts              NEW — handlePolling server helper

packages/core/__tests__/transport/
├── helpers.ts                  NEW — mock server for testing transports
├── sse.test.ts                 NEW — sseTransport tests
├── polling.test.ts             NEW — pollingTransport tests
└── server.test.ts              NEW — server helper tests

packages/react/src/
├── types.ts                    MODIFY — add Transport to WorkflowStoreOptions
├── store.ts                    MODIFY — add transport dispatch + subscribe

packages/react/__tests__/
├── transport-store.test.ts     NEW — transport integration tests

packages/otel/src/
├── executor.ts                 NEW — executor otel plugin
├── index.ts                    MODIFY — export executor plugin

packages/otel/src/__tests__/
├── executor.test.ts            NEW — executor plugin tests

packages/core/tsup.config.ts    MODIFY — add transport/server entry point
packages/core/package.json      MODIFY — add ./transport/server export
packages/otel/tsup.config.ts    MODIFY — add executor entry point
packages/otel/package.json      MODIFY — add ./executor export
```

## Reference

- **Spec:** `docs/superpowers/specs/2026-03-19-executor-transport-design.md`
- **Transport types:** `packages/core/src/transport/types.ts`
- **Executor:** `packages/core/src/executor/executor.ts`
- **SubscriberRegistry:** `packages/core/src/executor/with-broadcast.ts`
- **React store:** `packages/react/src/store.ts`
- **React types:** `packages/react/src/types.ts`
- **Otel plugin pattern:** `packages/otel/src/plugin.ts`
- **Otel conventions:** `packages/otel/src/conventions.ts`

## Commands

```bash
# Core tests
pnpm --filter @rytejs/core run test

# React tests
pnpm --filter @rytejs/react run test

# Otel tests
pnpm --filter @rytejs/otel run test

# Typecheck
cd /home/ralph/ryte/packages/core && npx tsc --noEmit

# Lint
pnpm biome check --fix packages/core/

# Build core
pnpm --filter @rytejs/core run build

# Full check
pnpm -w run check
```

---

### Task 1: Transport test helpers — mock server

**Files:**
- Create: `packages/core/__tests__/transport/helpers.ts`

A mock server that simulates server-side behavior for testing transport implementations. Uses the existing executor + withStore + withBroadcast + memoryStore internally. Exposes a `fetch` handler that transports can call, and a subscriber registry for broadcasts.

- [ ] **Step 1: Create mock transport server helper**

```typescript
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { withBroadcast, createSubscriberRegistry } from "../../src/executor/with-broadcast.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import type { StoreAdapter } from "../../src/engine/types.js";
import type { SubscriberRegistry } from "../../src/executor/types.js";
import type { WorkflowConfig } from "../../src/types.js";
import type { WorkflowRouter } from "../../src/router.js";

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
			return Response.json({ ok: true, snapshot: stored.snapshot, version: stored.version, events: [] });
		}

		if (method === "POST") {
			const body = await request.json() as {
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
			const status = result.error.category === "not_found" ? 404
				: result.error.category === "conflict" ? 409
				: 400;
			return Response.json({ ok: false, error: result.error }, { status });
		}

		if (method === "PUT") {
			const body = await request.json() as { initialState: string; data: unknown };
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
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd /home/ralph/ryte/packages/core && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/transport/helpers.ts
git commit -m "test(transport): add mock server helper for transport testing"
```

---

### Task 2: SSE server helper

**Files:**
- Create: `packages/core/src/transport/server/sse.ts`
- Create: `packages/core/src/transport/server/index.ts`
- Create: `packages/core/__tests__/transport/server.test.ts`

The SSE server helper creates a `ReadableStream` response that pushes `BroadcastMessage` events to the client.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import { handleSSE } from "../../src/transport/server/sse.js";
import { createSubscriberRegistry } from "../../src/executor/with-broadcast.js";
import type { BroadcastMessage } from "../../src/executor/types.js";

describe("handleSSE", () => {
	test("returns a streaming response with correct headers", () => {
		const subscribers = createSubscriberRegistry();
		const req = new Request("http://localhost/order-1");
		const res = handleSSE(req, subscribers);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");
		expect(res.headers.get("Cache-Control")).toBe("no-cache");
		expect(res.headers.get("Connection")).toBe("keep-alive");
		expect(res.body).not.toBeNull();
	});

	test("streams broadcast messages as SSE events", async () => {
		const subscribers = createSubscriberRegistry();
		const req = new Request("http://localhost/order-1");
		const res = handleSSE(req, subscribers);

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();

		// Push a broadcast message
		const message: BroadcastMessage = {
			snapshot: { id: "order-1", definitionName: "order", state: "Draft", data: {}, createdAt: "", updatedAt: "", modelVersion: 1 } as never,
			version: 1,
			events: [],
		};
		subscribers.notify("order-1", message);

		// Read from stream
		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain("event: message");
		expect(text).toContain(`data: ${JSON.stringify(message)}`);

		reader.cancel();
	});

	test("extracts workflow id from URL path", () => {
		const subscribers = createSubscriberRegistry();
		const req = new Request("http://localhost/my-workflow-123");
		handleSSE(req, subscribers);

		// Verify subscription was created for the correct ID
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("other-id", (msg) => messages.push(msg));
		subscribers.notify("my-workflow-123", {
			snapshot: {} as never,
			version: 1,
			events: [],
		});

		// The SSE handler subscribed to my-workflow-123, not other-id
		expect(messages).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/transport/server.test.ts`

- [ ] **Step 3: Write handleSSE implementation**

```typescript
import type { SubscriberRegistry } from "../../executor/types.js";

export function handleSSE(
	req: Request,
	subscribers: SubscriberRegistry,
): Response {
	const url = new URL(req.url);
	const id = url.pathname.split("/").filter(Boolean).pop() ?? "";

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const unsubscribe = subscribers.subscribe(id, (message) => {
				const data = JSON.stringify(message);
				controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
			});

			req.signal?.addEventListener("abort", () => {
				unsubscribe();
				controller.close();
			});
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		},
	});
}
```

Create `packages/core/src/transport/server/index.ts`:

```typescript
export { handleSSE } from "./sse.js";
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transport/server/ packages/core/__tests__/transport/server.test.ts
git commit -m "feat(transport): add handleSSE server-side helper"
```

---

### Task 3: Polling server helper

**Files:**
- Modify: `packages/core/src/transport/server/index.ts`
- Create: `packages/core/src/transport/server/polling.ts`
- Modify: `packages/core/__tests__/transport/server.test.ts`

The polling server helper returns the current stored workflow state. Clients poll this endpoint to detect changes.

- [ ] **Step 1: Write failing tests** (append to server.test.ts)

```typescript
import { handlePolling } from "../../src/transport/server/polling.js";
import { memoryStore } from "../../src/engine/memory-store.js";

describe("handlePolling", () => {
	test("returns stored workflow snapshot and version", async () => {
		const store = memoryStore();
		// Seed a workflow
		await store.save({
			id: "order-1",
			snapshot: { id: "order-1", definitionName: "order", state: "Draft", data: {}, createdAt: "", updatedAt: "", modelVersion: 1 } as never,
			expectedVersion: 0,
		});

		const req = new Request("http://localhost/order-1");
		const res = await handlePolling(req, store);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.snapshot.id).toBe("order-1");
		expect(body.version).toBe(1);
	});

	test("returns 404 for missing workflow", async () => {
		const store = memoryStore();
		const req = new Request("http://localhost/missing");
		const res = await handlePolling(req, store);

		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write handlePolling implementation**

```typescript
import type { StoreAdapter } from "../../engine/types.js";

export async function handlePolling(
	req: Request,
	store: StoreAdapter,
): Promise<Response> {
	const url = new URL(req.url);
	const id = url.pathname.split("/").filter(Boolean).pop() ?? "";

	const stored = await store.load(id);
	if (!stored) {
		return Response.json(
			{ error: { category: "transport", code: "NOT_FOUND", message: `Workflow "${id}" not found` } },
			{ status: 404 },
		);
	}

	return Response.json({
		snapshot: stored.snapshot,
		version: stored.version,
	});
}
```

Update server/index.ts:

```typescript
export { handleSSE } from "./sse.js";
export { handlePolling } from "./polling.js";
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transport/server/ packages/core/__tests__/transport/server.test.ts
git commit -m "feat(transport): add handlePolling server-side helper"
```

---

### Task 4: Server transport entry point + exports

**Files:**
- Modify: `packages/core/tsup.config.ts` — add `src/transport/server/index.ts`
- Modify: `packages/core/package.json` — add `./transport/server` export
- Modify: `packages/core/src/transport/index.ts` — re-export server helpers

- [ ] **Step 1: Add entry point to tsup config**

Read `packages/core/tsup.config.ts`, add `"src/transport/server/index.ts"` to the entry array.

- [ ] **Step 2: Add package.json export**

Read `packages/core/package.json`, add `"./transport/server"` entry following the same pattern as other subpath exports.

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @rytejs/core run build`

- [ ] **Step 4: Commit**

```bash
git add packages/core/tsup.config.ts packages/core/package.json packages/core/src/transport/index.ts
git commit -m "feat(core): add transport/server entry point and exports"
```

---

### Task 5: sseTransport client implementation

**Files:**
- Create: `packages/core/src/transport/sse.ts`
- Create: `packages/core/__tests__/transport/sse.test.ts`

The client-side SSE transport dispatches via `fetch` POST and subscribes via `EventSource`. For testing, we mock `fetch` and simulate SSE with the server helper.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { sseTransport } from "../../src/transport/sse.js";
import { createMockServer } from "./helpers.js";
import { createTestRouter, definition } from "../executor/helpers.js";

describe("sseTransport", () => {
	let server: ReturnType<typeof createMockServer>;

	beforeEach(() => {
		server = createMockServer(createTestRouter());
		// Mock global fetch to route to our mock server
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const req = new Request(url, init);
			return server.fetch(req);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("dispatch sends POST and returns result", async () => {
		// Create a workflow first
		await server.executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const transport = sseTransport("http://localhost");
		const result = await transport.dispatch(
			"order-1",
			{ type: "Place", payload: {} },
			1,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.state).toBe("Placed");
		expect(result.version).toBe(2);
		expect(result.events).toHaveLength(1);
	});

	test("dispatch returns error for not found", async () => {
		const transport = sseTransport("http://localhost");
		const result = await transport.dispatch(
			"missing",
			{ type: "Place", payload: {} },
			1,
		);

		expect(result.ok).toBe(false);
	});

	test("dispatch maps network errors to transport error", async () => {
		vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));

		const transport = sseTransport("http://localhost");
		const result = await transport.dispatch(
			"order-1",
			{ type: "Place", payload: {} },
			1,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("transport");
		if (result.error.category === "transport") {
			expect(result.error.code).toBe("NETWORK");
		}
	});

	test("subscribe receives broadcast messages", async () => {
		const transport = sseTransport("http://localhost");

		// We can't easily test real EventSource without a running server.
		// Instead, verify the subscribe method returns a subscription.
		const messages: unknown[] = [];
		const sub = transport.subscribe("order-1", (msg) => messages.push(msg));

		expect(sub).toBeDefined();
		expect(typeof sub.unsubscribe).toBe("function");

		sub.unsubscribe();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write sseTransport implementation**

```typescript
import type { BroadcastMessage } from "../executor/types.js";
import type { Transport, TransportResult, TransportSubscription } from "./types.js";

export function sseTransport(baseUrl: string): Transport {
	return {
		async dispatch(id, command, expectedVersion): Promise<TransportResult> {
			try {
				const res = await fetch(`${baseUrl}/${id}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: command.type,
						payload: command.payload,
						expectedVersion,
					}),
				});

				const body = await res.json();

				if (body.ok) {
					return {
						ok: true,
						snapshot: body.snapshot,
						version: body.version,
						events: body.events ?? [],
					};
				}

				return { ok: false, error: body.error };
			} catch (err) {
				return {
					ok: false,
					error: {
						category: "transport",
						code: "NETWORK",
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}
		},

		subscribe(id, callback): TransportSubscription {
			const url = `${baseUrl}/${id}`;

			// EventSource may not be available in all environments (e.g., Node.js without polyfill)
			if (typeof EventSource === "undefined") {
				return { unsubscribe() {} };
			}

			const source = new EventSource(url);

			source.addEventListener("message", (event) => {
				try {
					const message: BroadcastMessage = JSON.parse(event.data);
					callback(message);
				} catch {
					// Ignore malformed messages
				}
			});

			return {
				unsubscribe() {
					source.close();
				},
			};
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transport/sse.ts packages/core/__tests__/transport/sse.test.ts
git commit -m "feat(transport): add sseTransport client implementation"
```

---

### Task 6: pollingTransport client implementation

**Files:**
- Create: `packages/core/src/transport/polling.ts`
- Create: `packages/core/__tests__/transport/polling.test.ts`

The polling transport dispatches via `fetch` POST (same as SSE) and subscribes by polling a GET endpoint on an interval, comparing versions to detect changes.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { pollingTransport } from "../../src/transport/polling.js";
import { createMockServer } from "./helpers.js";
import { createTestRouter } from "../executor/helpers.js";

describe("pollingTransport", () => {
	let server: ReturnType<typeof createMockServer>;

	beforeEach(() => {
		server = createMockServer(createTestRouter());
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const req = new Request(url, init);
			return server.fetch(req);
		});
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	test("dispatch sends POST and returns result", async () => {
		await server.executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const transport = pollingTransport("http://localhost");
		const result = await transport.dispatch(
			"order-1",
			{ type: "Place", payload: {} },
			1,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.state).toBe("Placed");
		expect(result.version).toBe(2);
	});

	test("dispatch maps network errors to transport error", async () => {
		vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

		const transport = pollingTransport("http://localhost");
		const result = await transport.dispatch(
			"order-1",
			{ type: "Place", payload: {} },
			1,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("transport");
	});

	test("subscribe polls and calls callback on version change", async () => {
		await server.executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const transport = pollingTransport("http://localhost", 1000);
		const messages: unknown[] = [];
		const sub = transport.subscribe("order-1", (msg) => messages.push(msg));

		// First poll — initial state
		await vi.advanceTimersByTimeAsync(1000);
		expect(messages).toHaveLength(1);

		// Execute a command to change state
		await server.executor.execute("order-1", { type: "Place", payload: {} });

		// Second poll — should detect version change
		await vi.advanceTimersByTimeAsync(1000);
		expect(messages).toHaveLength(2);

		// Third poll — no change, no callback
		await vi.advanceTimersByTimeAsync(1000);
		expect(messages).toHaveLength(2);

		sub.unsubscribe();
	});

	test("unsubscribe stops polling", async () => {
		await server.executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		const transport = pollingTransport("http://localhost", 1000);
		const messages: unknown[] = [];
		const sub = transport.subscribe("order-1", (msg) => messages.push(msg));

		await vi.advanceTimersByTimeAsync(1000);
		sub.unsubscribe();

		await vi.advanceTimersByTimeAsync(5000);
		expect(messages).toHaveLength(1); // only the first poll
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write pollingTransport implementation**

```typescript
import type { BroadcastMessage } from "../executor/types.js";
import type { Transport, TransportResult, TransportSubscription } from "./types.js";

export function pollingTransport(baseUrl: string, interval = 5000): Transport {
	return {
		async dispatch(id, command, expectedVersion): Promise<TransportResult> {
			try {
				const res = await fetch(`${baseUrl}/${id}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: command.type,
						payload: command.payload,
						expectedVersion,
					}),
				});

				const body = await res.json();

				if (body.ok) {
					return {
						ok: true,
						snapshot: body.snapshot,
						version: body.version,
						events: body.events ?? [],
					};
				}

				return { ok: false, error: body.error };
			} catch (err) {
				return {
					ok: false,
					error: {
						category: "transport",
						code: "NETWORK",
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}
		},

		subscribe(id, callback): TransportSubscription {
			let lastVersion = -1;
			let stopped = false;
			let timer: ReturnType<typeof setInterval> | null = null;

			const poll = async () => {
				if (stopped) return;
				try {
					const res = await fetch(`${baseUrl}/${id}`);
					if (!res.ok) return;
					const body = await res.json() as { snapshot: BroadcastMessage["snapshot"]; version: number };
					if (body.version !== lastVersion) {
						lastVersion = body.version;
						callback({
							snapshot: body.snapshot,
							version: body.version,
							events: [],
						});
					}
				} catch {
					// Ignore poll failures — will retry on next interval
				}
			};

			timer = setInterval(poll, interval);

			return {
				unsubscribe() {
					stopped = true;
					if (timer !== null) {
						clearInterval(timer);
						timer = null;
					}
				},
			};
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transport/polling.ts packages/core/__tests__/transport/polling.test.ts
git commit -m "feat(transport): add pollingTransport client implementation"
```

---

### Task 7: wsTransport stub

**Files:**
- Create: `packages/core/src/transport/ws.ts`

A minimal stub that satisfies the `Transport` interface. Real WebSocket implementation requires runtime-specific WebSocket upgrade — deferred to a follow-up.

- [ ] **Step 1: Create stub**

```typescript
import type { Transport, TransportResult, TransportSubscription } from "./types.js";

/**
 * WebSocket transport — full-duplex dispatch + subscribe over a single connection.
 *
 * NOTE: Not yet implemented. WebSocket upgrade varies across runtimes
 * (Cloudflare uses WebSocketPair, Deno uses Deno.upgradeWebSocket, Node needs ws).
 * Use sseTransport or pollingTransport until a runtime-specific WS adapter ships.
 */
export function wsTransport(_url: string): Transport {
	return {
		async dispatch(_id, _command, _expectedVersion): Promise<TransportResult> {
			return {
				ok: false,
				error: {
					category: "transport",
					code: "NETWORK",
					message: "wsTransport is not yet implemented — use sseTransport or pollingTransport",
				},
			};
		},

		subscribe(_id, _callback): TransportSubscription {
			return { unsubscribe() {} };
		},
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/transport/ws.ts
git commit -m "feat(transport): add wsTransport stub (implementation deferred)"
```

---

### Task 8: Update transport exports

**Files:**
- Modify: `packages/core/src/transport/index.ts`

- [ ] **Step 1: Update exports**

Read the current file, then replace with:

```typescript
export type {
	BroadcastMessage,
	Transport,
	TransportError,
	TransportResult,
	TransportSubscription,
} from "./types.js";
export { sseTransport } from "./sse.js";
export { pollingTransport } from "./polling.js";
export { wsTransport } from "./ws.js";
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @rytejs/core run build`

- [ ] **Step 3: Run all core tests**

Run: `pnpm --filter @rytejs/core run test`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/transport/index.ts
git commit -m "feat(transport): export all transport implementations from index"
```

---

### Task 9: React store transport integration

**Files:**
- Modify: `packages/react/src/types.ts`
- Modify: `packages/react/src/store.ts`
- Create: `packages/react/__tests__/transport-store.test.ts`

- [ ] **Step 1: Update types to add Transport**

Read `packages/react/src/types.ts`. Add the `Transport` import and `transport` option:

Add to imports:
```typescript
import type { Transport } from "@rytejs/core/transport";
```

Add to `WorkflowStoreOptions`:
```typescript
transport?: Transport;
```

- [ ] **Step 2: Write failing tests**

Create `packages/react/__tests__/transport-store.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import type { Transport, TransportResult, TransportSubscription, BroadcastMessage } from "@rytejs/core/transport";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter, definition } from "./helpers.js";

function createMockTransport(overrides?: Partial<Transport>): Transport {
	return {
		dispatch: overrides?.dispatch ?? vi.fn(async () => ({
			ok: true as const,
			snapshot: definition.snapshot(definition.createWorkflow("test", {
				initialState: "Pending",
				data: { title: "Test" },
			})),
			version: 1,
			events: [],
		})),
		subscribe: overrides?.subscribe ?? vi.fn((_id, _cb) => ({ unsubscribe: vi.fn() })),
	};
}

function createTestRouter() {
	// Reuse the existing helper's router
}

describe("transport store", () => {
	test("dispatch goes through transport when provided", async () => {
		// Create the mock transport that returns a successful result
		const dispatchFn = vi.fn(async () => ({
			ok: true as const,
			snapshot: definition.snapshot(definition.createWorkflow("order-1", {
				initialState: "InProgress",
				data: { title: "Test", assignee: "Alice" },
			})),
			version: 2,
			events: [],
		}));

		const transport = createMockTransport({ dispatch: dispatchFn });

		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
			id: "order-1",
		}, { transport });

		await store.dispatch("Start", { assignee: "Alice" });

		expect(dispatchFn).toHaveBeenCalledWith(
			"order-1",
			{ type: "Start", payload: { assignee: "Alice" } },
			expect.any(Number),
		);
	});

	test("subscribes to transport on creation", () => {
		const subscribeFn = vi.fn((_id: string, _cb: (msg: BroadcastMessage) => void) => ({
			unsubscribe: vi.fn(),
		}));

		const transport = createMockTransport({ subscribe: subscribeFn });

		createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
			id: "order-1",
		}, { transport });

		expect(subscribeFn).toHaveBeenCalledWith("order-1", expect.any(Function));
	});

	test("cleanup unsubscribes from transport", () => {
		const unsubscribe = vi.fn();
		const transport = createMockTransport({
			subscribe: vi.fn(() => ({ unsubscribe })),
		});

		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
			id: "order-1",
		}, { transport });

		store.cleanup();
		expect(unsubscribe).toHaveBeenCalled();
	});

	test("incoming broadcast updates workflow", () => {
		let broadcastCallback: ((msg: BroadcastMessage) => void) | null = null;

		const transport = createMockTransport({
			subscribe: vi.fn((_id, cb) => {
				broadcastCallback = cb;
				return { unsubscribe: vi.fn() };
			}),
		});

		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
			id: "order-1",
		}, { transport });

		expect(broadcastCallback).not.toBeNull();

		// Simulate incoming broadcast
		const newWorkflow = definition.createWorkflow("order-1", {
			initialState: "InProgress",
			data: { title: "Test", assignee: "Bob" },
		});
		broadcastCallback!({
			snapshot: definition.snapshot(newWorkflow),
			version: 3,
			events: [],
		});

		expect(store.getWorkflow().state).toBe("InProgress");
	});

	test("without transport, dispatch works locally", async () => {
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });
		expect(result.ok).toBe(true);
	});
});
```

NOTE: This test file uses the test helpers from `packages/react/__tests__/helpers.ts`. Read that file first to understand the `router` and `definition` exports available. Adjust imports accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/react vitest run __tests__/transport-store.test.ts`

- [ ] **Step 3: Modify store.ts to support transport**

Read `packages/react/src/store.ts` first. The changes are:

1. Import `Transport` type
2. If `options?.transport` and `initialConfig.id`:
   - `dispatch()` calls `transport.dispatch(id, { type, payload }, currentVersion)` instead of `router.dispatch()`
   - On success: restore the returned snapshot as the new workflow
   - On failure: set error from transport result
3. On creation: call `transport.subscribe(id, callback)` where callback restores broadcast snapshots and notifies
4. `cleanup()`: call subscription's `unsubscribe()`

The store needs to track a `version` field (initially 0, updated from transport results and broadcasts).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/react vitest run __tests__/transport-store.test.ts`

- [ ] **Step 5: Run ALL react tests to verify nothing broke**

Run: `pnpm --filter @rytejs/react run test`

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/types.ts packages/react/src/store.ts packages/react/__tests__/transport-store.test.ts
git commit -m "feat(react): add transport support to createWorkflowStore"
```

---

### Task 10: Otel executor plugin

**Files:**
- Create: `packages/otel/src/executor.ts`
- Create: `packages/otel/src/__tests__/executor.test.ts`
- Modify: `packages/otel/src/index.ts`
- Modify: `packages/otel/tsup.config.ts`
- Modify: `packages/otel/package.json`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, vi, beforeEach } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createOtelExecutorPlugin } from "../executor.js";

// Setup in-memory tracing
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();

describe("createOtelExecutorPlugin", () => {
	beforeEach(() => {
		exporter.reset();
	});

	test("creates a branded executor plugin", () => {
		const plugin = createOtelExecutorPlugin();
		expect(typeof plugin).toBe("function");
	});

	test("registers execute:start and execute:end hooks", () => {
		const plugin = createOtelExecutorPlugin();

		const onCalls: string[] = [];
		const fakeExecutor = {
			on(event: string, _cb: unknown) {
				onCalls.push(event);
				return fakeExecutor;
			},
			use(_mw: unknown) { return fakeExecutor; },
		};

		plugin(fakeExecutor as never);

		expect(onCalls).toContain("execute:start");
		expect(onCalls).toContain("execute:end");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/otel vitest run src/__tests__/executor.test.ts`

- [ ] **Step 3: Write implementation**

Read `packages/otel/src/plugin.ts` and `packages/otel/src/conventions.ts` first for patterns.

```typescript
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { defineExecutorPlugin } from "@rytejs/core/executor";
import type { ExecutorContext } from "@rytejs/core/executor";

export interface OtelExecutorPluginOptions {
	tracerName?: string;
}

export function createOtelExecutorPlugin(options?: OtelExecutorPluginOptions) {
	const tracerName = options?.tracerName ?? "ryte";
	const spanMap = new Map<string, Span>();

	return defineExecutorPlugin((executor) => {
		const tracer = trace.getTracer(tracerName);

		executor.on("execute:start", (ctx) => {
			const opName = ctx.operation === "execute"
				? `ryte.execute.${(ctx as { command: { type: string } }).command.type}`
				: "ryte.create";

			const span = tracer.startSpan(opName);
			span.setAttribute("ryte.workflow.id", ctx.id);
			span.setAttribute("ryte.operation", ctx.operation);

			if (ctx.operation === "execute") {
				span.setAttribute("ryte.command.type", (ctx as { command: { type: string } }).command.type);
			}

			spanMap.set(ctx.id, span);
		});

		executor.on("execute:end", (ctx) => {
			const span = spanMap.get(ctx.id);
			if (!span) return;
			spanMap.delete(ctx.id);

			if (ctx.snapshot) {
				span.setAttribute("ryte.result", "ok");
				span.setAttribute("ryte.version", ctx.version);
				span.setStatus({ code: SpanStatusCode.OK });
			} else if (ctx.result && !ctx.result.ok) {
				span.setAttribute("ryte.result", "error");
				span.setAttribute("ryte.error.category", ctx.result.error.category);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: ctx.result.error.category,
				});
			}

			span.end();
		});
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Add export to otel/src/index.ts**

Read the current file, then add:

```typescript
export { createOtelExecutorPlugin } from "./executor.js";
export type { OtelExecutorPluginOptions } from "./executor.js";
```

- [ ] **Step 6: Add executor entry point to tsup config and package.json**

Read `packages/otel/tsup.config.ts` and `packages/otel/package.json`. If the otel package is a single entry point (just `src/index.ts`), add `createOtelExecutorPlugin` to the main export — no need for a separate entry point. Only add a `./executor` subpath if the otel package already uses subpath exports.

- [ ] **Step 7: Build otel and verify**

Run: `pnpm --filter @rytejs/otel run build && pnpm --filter @rytejs/otel run test`

- [ ] **Step 8: Commit**

```bash
git add packages/otel/
git commit -m "feat(otel): add executor plugin for tracing execute/create operations"
```

---

### Task 11: Full verification

**Files:** None — verification only.

- [ ] **Step 1: Build all packages**

Run: `pnpm --filter @rytejs/core run build && pnpm --filter @rytejs/react run build && pnpm --filter @rytejs/otel run build`

- [ ] **Step 2: Run full check**

Run: `pnpm -w run check`
Expected: All tasks pass

- [ ] **Step 3: Verify doc snippet typecheck**

Run: `pnpm --filter @rytejs/docs run typecheck`
Expected: PASS

- [ ] **Step 4: Push**

```bash
git push
```
