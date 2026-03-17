# @rytejs/sync Package Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side sync to the Ryte ecosystem — HTTP for commands, SSE for live updates, multi-client support.

**Architecture:** New `@rytejs/sync` package with pluggable transport interfaces (`CommandTransport`, `UpdateTransport`), built-in HTTP+SSE implementations, a server-side `Broadcaster` (decorator over `ExecutionEngine`), and mock test utilities. The existing `@rytejs/react` store gains a `sync` option that routes dispatch through the transport and applies SSE updates via `setWorkflow()`.

**Tech Stack:** TypeScript, native `fetch`/`ReadableStream` (no runtime deps), Vitest, tsup, Web `Response` API for SSE.

**Spec:** `docs/superpowers/specs/2026-03-17-sync-package-design.md`

---

## File Structure

### New files (`packages/sync/`)

| File | Responsibility |
|------|---------------|
| `package.json` | Package manifest with subpath exports (`.`, `./server`, `./testing`) |
| `tsup.config.ts` | Multi-entry build: `src/index.ts`, `src/server/index.ts`, `src/testing/index.ts` |
| `vitest.config.ts` | Test config (Node environment, no jsdom needed) |
| `src/types.ts` | `CommandTransport`, `UpdateTransport`, `SyncTransport`, `CommandResult`, `UpdateMessage`, `Subscription`, `TransportError` |
| `src/compose.ts` | `composeSyncTransport()` — merges command + update adapters |
| `src/index.ts` | Client public API exports |
| `src/transports/http-command.ts` | `httpCommandTransport()` — fetch-based command dispatch |
| `src/transports/sse-update.ts` | `sseUpdateTransport()` — fetch-based SSE reader for updates |
| `src/server/types.ts` | `Broadcaster`, `BroadcasterOptions` |
| `src/server/broadcaster.ts` | `createBroadcaster()` — decorator over engine, SSE streaming |
| `src/server/index.ts` | Server subpath exports |
| `src/testing/mock-command.ts` | `mockCommandTransport()` |
| `src/testing/mock-update.ts` | `mockUpdateTransport()` |
| `src/testing/index.ts` | Testing subpath exports |
| `__tests__/compose.test.ts` | composeSyncTransport tests |
| `__tests__/http-command.test.ts` | httpCommandTransport tests |
| `__tests__/sse-update.test.ts` | sseUpdateTransport tests |
| `__tests__/broadcaster.test.ts` | createBroadcaster tests |

### Modified files

| File | Change |
|------|--------|
| `packages/core/src/http/handler.ts:165` | POST response: convert `result.workflow` to snapshot |
| `packages/core/__tests__/http/handler.test.ts` | Update POST assertions for snapshot response |
| `packages/react/src/types.ts` | Widen `error` type, add `connectionStatus`, add dispatch options, add `cleanup()` |
| `packages/react/src/store.ts` | Sync dispatch routing, subscription wiring, connection status |
| `packages/react/src/use-workflow.ts` | Pass `connectionStatus` through to `UseWorkflowReturn` |
| `packages/react/__tests__/store.test.ts` | Add sync store tests |

---

## Task 1: Package Scaffolding

**Files:**
- Create: `packages/sync/package.json`
- Create: `packages/sync/tsconfig.json`
- Create: `packages/sync/tsup.config.ts`
- Create: `packages/sync/vitest.config.ts`
- Create: `packages/sync/src/index.ts` (empty placeholder)
- Create: `packages/sync/src/server/index.ts` (empty placeholder)
- Create: `packages/sync/src/testing/index.ts` (empty placeholder)

- [ ] **Step 1: Create `packages/sync/package.json`**

```json
{
	"name": "@rytejs/sync",
	"version": "0.1.0",
	"description": "Server-side sync transport for @rytejs workflows",
	"type": "module",
	"sideEffects": false,
	"engines": { "node": ">=18" },
	"files": ["dist"],
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js",
			"require": "./dist/index.cjs"
		},
		"./server": {
			"types": "./dist/server/index.d.ts",
			"import": "./dist/server/index.js",
			"require": "./dist/server/index.cjs"
		},
		"./testing": {
			"types": "./dist/testing/index.d.ts",
			"import": "./dist/testing/index.js",
			"require": "./dist/testing/index.cjs"
		}
	},
	"scripts": {
		"build": "tsup",
		"test": "vitest run",
		"test:watch": "vitest",
		"typecheck": "tsc --noEmit"
	},
	"peerDependencies": {
		"@rytejs/core": "workspace:^"
	},
	"devDependencies": {
		"@rytejs/core": "workspace:^",
		"tsup": "^8.4.0",
		"typescript": "^5.7.0",
		"vitest": "^3.0.0"
	}
}
```

- [ ] **Step 2: Create `packages/sync/tsconfig.json`**

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
		"rootDir": "src"
	},
	"include": ["src"]
}
```

- [ ] **Step 3: Create `packages/sync/tsup.config.ts`**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/server/index.ts", "src/testing/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

- [ ] **Step 4: Create `packages/sync/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		passWithNoTests: true,
	},
});
```

- [ ] **Step 5: Create placeholder entry files**

`packages/sync/src/index.ts`:
```typescript
export {};
```

`packages/sync/src/server/index.ts`:
```typescript
export {};
```

`packages/sync/src/testing/index.ts`:
```typescript
export {};
```

- [ ] **Step 6: Install dependencies and verify build**

Run: `pnpm install && pnpm --filter @rytejs/sync build`
Expected: Build succeeds, `dist/` created with three entry points.

- [ ] **Step 7: Commit**

```bash
git add packages/sync/
git commit -m "feat(sync): scaffold @rytejs/sync package with subpath exports"
```

---

## Task 2: Transport Types + composeSyncTransport

**Files:**
- Create: `packages/sync/src/types.ts`
- Create: `packages/sync/src/compose.ts`
- Create: `packages/sync/__tests__/compose.test.ts`
- Modify: `packages/sync/src/index.ts`

- [ ] **Step 1: Write `packages/sync/src/types.ts`**

```typescript
import type { PipelineError, WorkflowConfig, WorkflowSnapshot } from "@rytejs/core";

export interface TransportError {
	category: "transport";
	code: "NETWORK" | "TIMEOUT" | "SERVER" | "PARSE";
	message: string;
	cause?: unknown;
}

export type CommandResult =
	| { ok: true; snapshot: WorkflowSnapshot; version: number }
	| { ok: false; error: PipelineError<WorkflowConfig> | TransportError };

export interface UpdateMessage {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface Subscription {
	unsubscribe(): void;
}

export interface CommandTransport {
	dispatch(
		workflowId: string,
		command: { type: string; payload: unknown },
	): Promise<CommandResult>;
}

export interface UpdateTransport {
	subscribe(
		workflowId: string,
		listener: (message: UpdateMessage) => void,
	): Subscription;
}

export interface SyncTransport extends CommandTransport, UpdateTransport {}
```

- [ ] **Step 2: Write the failing test for composeSyncTransport**

`packages/sync/__tests__/compose.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { composeSyncTransport } from "../src/compose.js";
import type { CommandResult, CommandTransport, UpdateTransport } from "../src/types.js";

describe("composeSyncTransport", () => {
	test("delegates dispatch to command transport", async () => {
		const result: CommandResult = {
			ok: true,
			snapshot: {} as never,
			version: 1,
		};
		const commands: CommandTransport = {
			dispatch: vi.fn().mockResolvedValue(result),
		};
		const updates: UpdateTransport = {
			subscribe: vi.fn(),
		};

		const transport = composeSyncTransport({ commands, updates });
		const actual = await transport.dispatch("wf-1", { type: "Start", payload: { assignee: "Alice" } });

		expect(commands.dispatch).toHaveBeenCalledWith("wf-1", { type: "Start", payload: { assignee: "Alice" } });
		expect(actual).toBe(result);
	});

	test("delegates subscribe to update transport", () => {
		const unsub = { unsubscribe: vi.fn() };
		const commands: CommandTransport = {
			dispatch: vi.fn(),
		};
		const updates: UpdateTransport = {
			subscribe: vi.fn().mockReturnValue(unsub),
		};

		const transport = composeSyncTransport({ commands, updates });
		const listener = vi.fn();
		const sub = transport.subscribe("wf-1", listener);

		expect(updates.subscribe).toHaveBeenCalledWith("wf-1", listener);
		expect(sub).toBe(unsub);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/compose.test.ts`
Expected: FAIL — `compose.js` doesn't exist.

- [ ] **Step 4: Write `packages/sync/src/compose.ts`**

```typescript
import type { CommandTransport, SyncTransport, UpdateTransport } from "./types.js";

export function composeSyncTransport(adapters: {
	commands: CommandTransport;
	updates: UpdateTransport;
}): SyncTransport {
	return {
		dispatch: (workflowId, command) => adapters.commands.dispatch(workflowId, command),
		subscribe: (workflowId, listener) => adapters.updates.subscribe(workflowId, listener),
	};
}
```

- [ ] **Step 5: Update `packages/sync/src/index.ts`**

```typescript
export type {
	CommandResult,
	CommandTransport,
	Subscription,
	SyncTransport,
	TransportError,
	UpdateMessage,
	UpdateTransport,
} from "./types.js";
export { composeSyncTransport } from "./compose.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/compose.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm --filter @rytejs/sync tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sync/src/types.ts packages/sync/src/compose.ts packages/sync/src/index.ts packages/sync/__tests__/compose.test.ts
git commit -m "feat(sync): add transport types and composeSyncTransport"
```

---

## Task 3: Mock Test Utilities

**Files:**
- Create: `packages/sync/src/testing/mock-command.ts`
- Create: `packages/sync/src/testing/mock-update.ts`
- Modify: `packages/sync/src/testing/index.ts`
- Create: `packages/sync/__tests__/mock-transports.test.ts`

- [ ] **Step 1: Write failing tests for mock transports**

`packages/sync/__tests__/mock-transports.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { mockCommandTransport } from "../src/testing/mock-command.js";
import { mockUpdateTransport } from "../src/testing/mock-update.js";
import type { CommandResult, UpdateMessage } from "../src/types.js";

describe("mockCommandTransport", () => {
	test("calls handler with workflowId and command", async () => {
		const result: CommandResult = { ok: true, snapshot: {} as never, version: 1 };
		const handler = vi.fn().mockReturnValue(result);
		const transport = mockCommandTransport(handler);

		const actual = await transport.dispatch("wf-1", { type: "Submit", payload: { x: 1 } });

		expect(handler).toHaveBeenCalledWith("wf-1", { type: "Submit", payload: { x: 1 } });
		expect(actual).toBe(result);
	});

	test("handler can return async results", async () => {
		const result: CommandResult = { ok: false, error: { category: "transport", code: "NETWORK", message: "fail" } };
		const handler = vi.fn().mockResolvedValue(result);
		const transport = mockCommandTransport(handler);

		const actual = await transport.dispatch("wf-1", { type: "Start", payload: { assignee: "Alice" } });
		expect(actual).toBe(result);
	});
});

describe("mockUpdateTransport", () => {
	test("subscribe returns a subscription", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		const sub = mock.subscribe("wf-1", listener);

		expect(sub).toHaveProperty("unsubscribe");
	});

	test("push delivers message to matching subscribers", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);

		const message: UpdateMessage = { snapshot: {} as never, version: 1 };
		mock.push("wf-1", message);

		expect(listener).toHaveBeenCalledWith(message);
	});

	test("push does not deliver to unsubscribed listeners", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		const sub = mock.subscribe("wf-1", listener);
		sub.unsubscribe();

		mock.push("wf-1", { snapshot: {} as never, version: 1 });

		expect(listener).not.toHaveBeenCalled();
	});

	test("push does not deliver to other workflow IDs", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);

		mock.push("wf-2", { snapshot: {} as never, version: 1 });

		expect(listener).not.toHaveBeenCalled();
	});

	test("disconnect stops all deliveries", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);
		mock.disconnect();

		mock.push("wf-1", { snapshot: {} as never, version: 1 });

		expect(listener).not.toHaveBeenCalled();
	});

	test("reconnect resumes deliveries", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);
		mock.disconnect();
		mock.reconnect();

		const message: UpdateMessage = { snapshot: {} as never, version: 1 };
		mock.push("wf-1", message);

		expect(listener).toHaveBeenCalledWith(message);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/mock-transports.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write `packages/sync/src/testing/mock-command.ts`**

```typescript
import type { CommandResult, CommandTransport } from "../types.js";

export function mockCommandTransport(
	handler: (
		workflowId: string,
		command: { type: string; payload: unknown },
	) => CommandResult | Promise<CommandResult>,
): CommandTransport {
	return {
		async dispatch(workflowId, command) {
			return handler(workflowId, command);
		},
	};
}
```

- [ ] **Step 4: Write `packages/sync/src/testing/mock-update.ts`**

```typescript
import type { Subscription, UpdateMessage, UpdateTransport } from "../types.js";

export function mockUpdateTransport(): UpdateTransport & {
	push(workflowId: string, message: UpdateMessage): void;
	disconnect(): void;
	reconnect(): void;
} {
	const subscribers = new Map<string, Set<(message: UpdateMessage) => void>>();
	let connected = true;

	return {
		subscribe(workflowId, listener) {
			if (!subscribers.has(workflowId)) {
				subscribers.set(workflowId, new Set());
			}
			const set = subscribers.get(workflowId)!;
			set.add(listener);

			return {
				unsubscribe() {
					set.delete(listener);
				},
			};
		},

		push(workflowId, message) {
			if (!connected) return;
			const set = subscribers.get(workflowId);
			if (set) {
				for (const listener of set) {
					listener(message);
				}
			}
		},

		disconnect() {
			connected = false;
		},

		reconnect() {
			connected = true;
		},
	};
}
```

- [ ] **Step 5: Update `packages/sync/src/testing/index.ts`**

```typescript
export { mockCommandTransport } from "./mock-command.js";
export { mockUpdateTransport } from "./mock-update.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/mock-transports.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/sync/src/testing/ packages/sync/__tests__/mock-transports.test.ts
git commit -m "feat(sync): add mock test utilities for command and update transports"
```

---

## Task 4: httpCommandTransport

**Files:**
- Create: `packages/sync/src/transports/http-command.ts`
- Create: `packages/sync/__tests__/http-command.test.ts`
- Modify: `packages/sync/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/sync/__tests__/http-command.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { httpCommandTransport } from "../src/transports/http-command.js";

describe("httpCommandTransport", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("sends POST to correct URL with command body", async () => {
		const snapshot = { id: "wf-1", definitionName: "orders", state: "Draft", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, snapshot, version: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const transport = httpCommandTransport({ url: "http://localhost:3000/api", router: "orders" });
		const result = await transport.dispatch("wf-1", { type: "PlaceOrder", payload: { items: [] } });

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:3000/api/orders/wf-1",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ "Content-Type": "application/json" }),
				body: JSON.stringify({ type: "PlaceOrder", payload: { items: [] } }),
			}),
		);
		expect(result).toEqual({ ok: true, snapshot, version: 1 });
	});

	test("includes static headers", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, snapshot: {}, version: 1 }), { status: 200 }),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
			headers: { Authorization: "Bearer token123" },
		});
		await transport.dispatch("wf-1", { type: "Start", payload: { assignee: "Alice" } });

		expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
			headers: expect.objectContaining({ Authorization: "Bearer token123" }),
		});
	});

	test("includes dynamic headers from function", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, snapshot: {}, version: 1 }), { status: 200 }),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
			headers: () => ({ Authorization: "Bearer dynamic" }),
		});
		await transport.dispatch("wf-1", { type: "Start", payload: { assignee: "Alice" } });

		expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
			headers: expect.objectContaining({ Authorization: "Bearer dynamic" }),
		});
	});

	test("returns error result for pipeline errors", async () => {
		const error = { category: "validation", source: "command", issues: [], message: "bad" };
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: false, error }), { status: 400 }),
		);

		const transport = httpCommandTransport({ url: "http://localhost:3000", router: "orders" });
		const result = await transport.dispatch("wf-1", { type: "Bad", payload: {} });

		expect(result).toEqual({ ok: false, error });
	});

	test("returns transport error on network failure", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

		const transport = httpCommandTransport({ url: "http://localhost:3000", router: "orders" });
		const result = await transport.dispatch("wf-1", { type: "Start", payload: { assignee: "Alice" } });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("transport");
			expect((result.error as { code: string }).code).toBe("NETWORK");
		}
	});

	test("returns transport error on non-JSON response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response("Internal Server Error", { status: 500 }),
		);

		const transport = httpCommandTransport({ url: "http://localhost:3000", router: "orders" });
		const result = await transport.dispatch("wf-1", { type: "Start", payload: { assignee: "Alice" } });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("transport");
			expect((result.error as { code: string }).code).toBe("PARSE");
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/http-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/sync/src/transports/http-command.ts`**

```typescript
import type { CommandResult, CommandTransport, TransportError } from "../types.js";

export interface HttpCommandOptions {
	/** Base URL of the engine HTTP handler */
	url: string;
	/** Router name for URL construction (e.g. "orders" → POST {url}/orders/{id}) */
	router: string;
	/** Headers sent with every request (auth tokens, etc.) */
	headers?: Record<string, string> | (() => Record<string, string>);
}

export function httpCommandTransport(options: HttpCommandOptions): CommandTransport {
	const { url, router, headers } = options;

	return {
		async dispatch(workflowId, command) {
			const resolvedHeaders = typeof headers === "function" ? headers() : headers ?? {};

			let response: Response;
			try {
				response = await fetch(`${url}/${router}/${workflowId}`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...resolvedHeaders,
					},
					body: JSON.stringify(command),
				});
			} catch (err) {
				const transportError: TransportError = {
					category: "transport",
					code: "NETWORK",
					message: err instanceof Error ? err.message : "Network request failed",
					cause: err,
				};
				return { ok: false, error: transportError };
			}

			let body: unknown;
			try {
				body = await response.json();
			} catch {
				const transportError: TransportError = {
					category: "transport",
					code: "PARSE",
					message: `Failed to parse response (status ${response.status})`,
				};
				return { ok: false, error: transportError };
			}

			return body as CommandResult;
		},
	};
}
```

- [ ] **Step 4: Add export to `packages/sync/src/index.ts`**

Add after existing exports:
```typescript
export { httpCommandTransport, type HttpCommandOptions } from "./transports/http-command.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/http-command.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/transports/http-command.ts packages/sync/__tests__/http-command.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): add httpCommandTransport with fetch-based dispatch"
```

---

## Task 5: sseUpdateTransport

**Files:**
- Create: `packages/sync/src/transports/sse-update.ts`
- Create: `packages/sync/__tests__/sse-update.test.ts`
- Modify: `packages/sync/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/sync/__tests__/sse-update.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sseUpdateTransport } from "../src/transports/sse-update.js";
import type { UpdateMessage } from "../src/types.js";

function createMockSSEResponse(messages: string[]): Response {
	const encoder = new TextEncoder();
	let index = 0;
	const stream = new ReadableStream({
		pull(controller) {
			if (index < messages.length) {
				controller.enqueue(encoder.encode(messages[index]));
				index++;
			} else {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

describe("sseUpdateTransport", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("opens SSE connection to correct URL", () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			createMockSSEResponse([]),
		);

		const transport = sseUpdateTransport({ url: "http://localhost:3000/api", router: "orders" });
		transport.subscribe("wf-1", vi.fn());

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:3000/api/orders/wf-1/events",
			expect.objectContaining({
				headers: expect.objectContaining({ Accept: "text/event-stream" }),
			}),
		);
	});

	test("parses SSE messages and calls listener", async () => {
		const snapshot = { id: "wf-1", definitionName: "orders", state: "Draft", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		const message = `data: ${JSON.stringify({ snapshot, version: 1 })}\n\n`;

		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([message]));

		const listener = vi.fn();
		const transport = sseUpdateTransport({ url: "http://localhost:3000", router: "orders" });
		transport.subscribe("wf-1", listener);

		// Wait for async stream processing
		await vi.waitFor(() => {
			expect(listener).toHaveBeenCalledWith({ snapshot, version: 1 });
		});
	});

	test("handles multi-chunk SSE data", async () => {
		const snapshot = { id: "wf-1", definitionName: "orders", state: "Done", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		const fullMessage = `data: ${JSON.stringify({ snapshot, version: 2 })}\n\n`;
		// Split the message into two chunks
		const mid = Math.floor(fullMessage.length / 2);

		vi.mocked(globalThis.fetch).mockResolvedValue(
			createMockSSEResponse([fullMessage.slice(0, mid), fullMessage.slice(mid)]),
		);

		const listener = vi.fn();
		const transport = sseUpdateTransport({ url: "http://localhost:3000", router: "orders" });
		transport.subscribe("wf-1", listener);

		await vi.waitFor(() => {
			expect(listener).toHaveBeenCalledWith({ snapshot, version: 2 });
		});
	});

	test("unsubscribe stops listening", async () => {
		const controller = { abort: vi.fn() };
		vi.spyOn(globalThis, "AbortController").mockReturnValue(controller as unknown as AbortController);
		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([]));

		const transport = sseUpdateTransport({ url: "http://localhost:3000", router: "orders" });
		const sub = transport.subscribe("wf-1", vi.fn());
		sub.unsubscribe();

		expect(controller.abort).toHaveBeenCalled();
	});

	test("includes custom headers", () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([]));

		const transport = sseUpdateTransport({
			url: "http://localhost:3000",
			router: "orders",
			headers: { Authorization: "Bearer token" },
		});
		transport.subscribe("wf-1", vi.fn());

		expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
			headers: expect.objectContaining({ Authorization: "Bearer token" }),
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/sse-update.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/sync/src/transports/sse-update.ts`**

```typescript
import type { Subscription, UpdateMessage, UpdateTransport } from "../types.js";

export interface SseUpdateOptions {
	/** Base URL for SSE endpoint */
	url: string;
	/** Router name for URL construction */
	router: string;
	/** Headers for the connection (auth, etc.) */
	headers?: Record<string, string> | (() => Record<string, string>);
	/** Reconnect delay in ms after connection drop. Default: 1000 */
	reconnectDelay?: number;
}

export function sseUpdateTransport(options: SseUpdateOptions): UpdateTransport {
	const { url, router, headers, reconnectDelay = 1000 } = options;

	return {
		subscribe(workflowId, listener) {
			const abortController = new AbortController();
			let stopped = false;

			function connect() {
				if (stopped) return;

				const resolvedHeaders = typeof headers === "function" ? headers() : headers ?? {};

				fetch(`${url}/${router}/${workflowId}/events`, {
					headers: {
						Accept: "text/event-stream",
						...resolvedHeaders,
					},
					signal: abortController.signal,
				})
					.then((response) => {
						if (!response.body) return;
						const reader = response.body.getReader();
						const decoder = new TextDecoder();
						let buffer = "";

						function read(): Promise<void> {
							return reader.read().then(({ done, value }) => {
								if (done || stopped) return;

								buffer += decoder.decode(value, { stream: true });

								const parts = buffer.split("\n\n");
								// Last element is incomplete — keep in buffer
								buffer = parts.pop() ?? "";

								for (const part of parts) {
									const dataLine = part
										.split("\n")
										.find((line) => line.startsWith("data: "));
									if (!dataLine) continue;

									try {
										const json = JSON.parse(dataLine.slice(6)) as UpdateMessage;
										listener(json);
									} catch {
										// Skip malformed messages
									}
								}

								return read();
							});
						}

						return read();
					})
					.catch(() => {
						if (!stopped) {
							setTimeout(connect, reconnectDelay);
						}
					});
			}

			connect();

			return {
				unsubscribe() {
					stopped = true;
					abortController.abort();
				},
			};
		},
	};
}
```

- [ ] **Step 4: Add export to `packages/sync/src/index.ts`**

Add after existing exports:
```typescript
export { sseUpdateTransport, type SseUpdateOptions } from "./transports/sse-update.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/sse-update.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/transports/sse-update.ts packages/sync/__tests__/sse-update.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): add sseUpdateTransport with fetch-based SSE reader"
```

---

## Task 6: Server-Side Broadcaster

**Files:**
- Create: `packages/sync/src/server/types.ts`
- Create: `packages/sync/src/server/broadcaster.ts`
- Modify: `packages/sync/src/server/index.ts`
- Create: `packages/sync/__tests__/broadcaster.test.ts`

This task requires `@rytejs/core/engine` types. The broadcaster wraps `ExecutionEngine` using the decorator pattern.

- [ ] **Step 1: Write `packages/sync/src/server/types.ts`**

```typescript
import type { ExecutionEngine, ExecutionResult } from "@rytejs/core/engine";

export interface BroadcasterOptions {
	engine: ExecutionEngine;
}

export interface Broadcaster {
	execute(
		routerName: string,
		workflowId: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult>;
	subscribe(routerName: string, workflowId: string): Promise<Response>;
	connectionCount(routerName: string, workflowId: string): number;
	close(): void;
}
```

- [ ] **Step 2: Write failing tests**

`packages/sync/__tests__/broadcaster.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { createBroadcaster } from "../src/server/broadcaster.js";
import type { ExecutionEngine, ExecutionResult, StoredWorkflow } from "@rytejs/core/engine";

function createMockEngine(overrides: Partial<ExecutionEngine> = {}) {
	return {
		load: vi.fn(),
		create: vi.fn(),
		execute: vi.fn(),
		getRouter: vi.fn(),
		...overrides,
	} as unknown as ExecutionEngine;
}

describe("createBroadcaster", () => {
	test("execute delegates to engine and returns result", async () => {
		const execResult: ExecutionResult = {
			result: { ok: true, workflow: {} as never, events: [] },
			events: [],
			version: 2,
		};
		const engine = createMockEngine({
			execute: vi.fn().mockResolvedValue(execResult),
		});

		const broadcaster = createBroadcaster({ engine });
		const result = await broadcaster.execute("orders", "wf-1", { type: "Start", payload: { assignee: "Alice" } });

		expect(engine.execute).toHaveBeenCalledWith("orders", "wf-1", { type: "Start", payload: { assignee: "Alice" } });
		expect(result).toBe(execResult);
	});

	test("subscribe returns SSE response with correct headers", async () => {
		const snapshot = { id: "wf-1", definitionName: "orders", state: "Draft", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("Connection")).toBe("keep-alive");
	});

	test("subscribe sends initial snapshot as first SSE message", async () => {
		const snapshot = { id: "wf-1", definitionName: "orders", state: "Draft", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");

		const reader = response.body!.getReader();
		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);

		expect(text).toContain(`data: ${JSON.stringify({ snapshot, version: 1 })}`);
		reader.cancel();
	});

	test("execute broadcasts to subscribed clients", async () => {
		const snapshot1 = { id: "wf-1", definitionName: "orders", state: "Draft", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		const snapshot2 = { ...snapshot1, state: "Placed" };

		const router = { definition: { snapshot: vi.fn().mockReturnValue(snapshot2) } };
		const execResult: ExecutionResult = {
			result: { ok: true, workflow: {} as never, events: [] },
			events: [],
			version: 2,
		};

		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot: snapshot1, version: 1 }),
			execute: vi.fn().mockResolvedValue(execResult),
			getRouter: vi.fn().mockReturnValue(router),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");
		const reader = response.body!.getReader();

		// Read initial snapshot
		await reader.read();

		// Execute a command — should broadcast
		await broadcaster.execute("orders", "wf-1", { type: "Place", payload: {} });

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain(`data: ${JSON.stringify({ snapshot: snapshot2, version: 2 })}`);
		reader.cancel();
	});

	test("connectionCount returns number of active subscribers", async () => {
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot: {}, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(0);

		const response = await broadcaster.subscribe("orders", "wf-1");
		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(1);

		// Cancel the stream to simulate disconnect
		await response.body!.cancel();

		// Give the cancel time to propagate
		await new Promise((r) => setTimeout(r, 10));
		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(0);
	});

	test("close cancels all connections", async () => {
		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot: {}, version: 1 }),
		});

		const broadcaster = createBroadcaster({ engine });
		await broadcaster.subscribe("orders", "wf-1");
		await broadcaster.subscribe("orders", "wf-2");

		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(1);
		expect(broadcaster.connectionCount("orders", "wf-2")).toBe(1);

		broadcaster.close();

		expect(broadcaster.connectionCount("orders", "wf-1")).toBe(0);
		expect(broadcaster.connectionCount("orders", "wf-2")).toBe(0);
	});

	test("failed execute does not broadcast", async () => {
		const snapshot = { id: "wf-1", definitionName: "orders", state: "Draft", data: {}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", modelVersion: 1 };
		const execResult: ExecutionResult = {
			result: { ok: false, error: { category: "validation", source: "command", issues: [], message: "bad" } } as never,
			events: [],
			version: 1,
		};

		const engine = createMockEngine({
			load: vi.fn().mockResolvedValue({ snapshot, version: 1 }),
			execute: vi.fn().mockResolvedValue(execResult),
		});

		const broadcaster = createBroadcaster({ engine });
		const response = await broadcaster.subscribe("orders", "wf-1");
		const reader = response.body!.getReader();

		// Read initial snapshot
		await reader.read();

		// Execute a failing command
		await broadcaster.execute("orders", "wf-1", { type: "Bad", payload: {} });

		// No more data should be available (non-blocking check)
		const readPromise = reader.read();
		const timeout = new Promise((r) => setTimeout(() => r("timeout"), 50));
		const result = await Promise.race([readPromise, timeout]);

		expect(result).toBe("timeout");
		reader.cancel();
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/broadcaster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `packages/sync/src/server/broadcaster.ts`**

```typescript
import type { ExecutionEngine, ExecutionResult } from "@rytejs/core/engine";
import type { Broadcaster, BroadcasterOptions } from "./types.js";

function compositeKey(routerName: string, workflowId: string): string {
	return `${routerName}:${workflowId}`;
}

function formatSSE(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export function createBroadcaster(options: BroadcasterOptions): Broadcaster {
	const { engine } = options;
	const connections = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
	const encoder = new TextEncoder();

	function getOrCreateSet(key: string): Set<ReadableStreamDefaultController<Uint8Array>> {
		let set = connections.get(key);
		if (!set) {
			set = new Set();
			connections.set(key, set);
		}
		return set;
	}

	function broadcast(key: string, data: unknown): void {
		const set = connections.get(key);
		if (!set) return;

		const encoded = encoder.encode(formatSSE(data));
		for (const controller of set) {
			try {
				controller.enqueue(encoded);
			} catch {
				// Controller may be closed — cleanup happens on cancel
			}
		}
	}

	return {
		async execute(routerName, workflowId, command) {
			const result = await engine.execute(routerName, workflowId, command);

			if (result.result.ok) {
				const router = engine.getRouter(routerName);
				const snapshot = router.definition.snapshot(result.result.workflow);
				broadcast(compositeKey(routerName, workflowId), {
					snapshot,
					version: result.version,
				});
			}

			return result;
		},

		async subscribe(routerName, workflowId) {
			const stored = await engine.load(workflowId);
			const key = compositeKey(routerName, workflowId);

			let streamController: ReadableStreamDefaultController<Uint8Array>;

			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamController = controller;
					getOrCreateSet(key).add(controller);

					// Send initial snapshot
					if (stored) {
						controller.enqueue(
							encoder.encode(
								formatSSE({ snapshot: stored.snapshot, version: stored.version }),
							),
						);
					}
				},
				cancel() {
					const set = connections.get(key);
					if (set) {
						set.delete(streamController);
						if (set.size === 0) {
							connections.delete(key);
						}
					}
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

		connectionCount(routerName, workflowId) {
			const set = connections.get(compositeKey(routerName, workflowId));
			return set ? set.size : 0;
		},

		close() {
			for (const [key, set] of connections) {
				for (const controller of set) {
					try {
						controller.close();
					} catch {
						// Already closed
					}
				}
				set.clear();
			}
			connections.clear();
		},
	};
}
```

- [ ] **Step 5: Update `packages/sync/src/server/index.ts`**

```typescript
export { createBroadcaster } from "./broadcaster.js";
export type { Broadcaster, BroadcasterOptions } from "./types.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @rytejs/sync vitest run __tests__/broadcaster.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 7: Verify full package builds and tests pass**

Run: `pnpm --filter @rytejs/sync vitest run && pnpm --filter @rytejs/sync tsc --noEmit`
Expected: All tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sync/src/server/ packages/sync/__tests__/broadcaster.test.ts
git commit -m "feat(sync): add server-side broadcaster with SSE streaming"
```

---

## Task 7: HTTP Handler Prerequisite Fix

**Files:**
- Modify: `packages/core/src/http/handler.ts:165`
- Modify: `packages/core/src/http/__tests__/handler.test.ts` (if POST assertions check `workflow` field)

The POST endpoint currently returns `execResult.result.workflow` (a hydrated `Workflow` with Date objects, no `modelVersion`). It must return a `WorkflowSnapshot` instead, matching GET and PUT.

- [ ] **Step 1: Check existing handler tests for POST response shape**

Run: `pnpm --filter @rytejs/core vitest run -- handler` to see which tests exist, then read the test file to understand the assertions.

Look at: `packages/core/src/http/__tests__/handler.test.ts` (or similar path — find it with glob).

- [ ] **Step 2: Modify handler POST success response**

In `packages/core/src/http/handler.ts`, change lines 165-169 from:

```typescript
return jsonResponse(200, {
	ok: true,
	workflow: execResult.result.workflow,
	events: execResult.events,
	version: execResult.version,
});
```

To:

```typescript
const router = engine.getRouter(name);
const snapshot = router.definition.snapshot(execResult.result.workflow);
return jsonResponse(200, {
	ok: true,
	snapshot,
	events: execResult.events,
	version: execResult.version,
});
```

Note: This changes the response field from `workflow` to `snapshot` for the POST endpoint. Also update GET (line 87-91) and PUT (line 119-123) for consistency — rename `workflow` to `snapshot` in their response bodies:

GET:
```typescript
return jsonResponse(200, {
	ok: true,
	snapshot: stored.snapshot,
	version: stored.version,
});
```

PUT:
```typescript
return jsonResponse(201, {
	ok: true,
	snapshot: result.workflow,
	version: result.version,
});
```

- [ ] **Step 3: Update handler tests to match new response shape**

Update any test assertions that check for `body.workflow` to check `body.snapshot` instead.

- [ ] **Step 4: Run handler tests**

Run: `pnpm --filter @rytejs/core vitest run -- handler`
Expected: PASS.

- [ ] **Step 5: Run full core tests to check for regressions**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All tests pass.

- [ ] **Step 6: Rebuild core dist**

Run: `pnpm --filter @rytejs/core tsup`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/http/handler.ts packages/core/__tests__/http/
git commit -m "fix(http): return WorkflowSnapshot in all handler responses

POST was returning a hydrated Workflow object (missing modelVersion).
Now all endpoints (GET, PUT, POST) consistently return snapshot.
Response field renamed from 'workflow' to 'snapshot'."
```

---

## Task 8: React Type Changes + Server-Authoritative Sync Dispatch

**Files:**
- Modify: `packages/react/src/types.ts`
- Modify: `packages/react/src/store.ts`
- Modify: `packages/react/src/use-workflow.ts`
- Modify: `packages/react/__tests__/store.test.ts`

- [ ] **Step 1: Update `packages/react/src/types.ts`**

Add the `TransportError` import and update interfaces:

```typescript
import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	MigrationPipeline,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowOf,
} from "@rytejs/core";
import type { SyncTransport, TransportError } from "@rytejs/sync";

export interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | TransportError | null;
	readonly connectionStatus?: "connected" | "reconnecting" | "disconnected";
}

export interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig>;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
		options?: { optimistic?: boolean },
	): Promise<DispatchResult<TConfig>>;
	setWorkflow(workflow: Workflow<TConfig>): void;
	cleanup(): void;
}

export interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
	sync?: SyncTransport;
}

export interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly state: StateNames<TConfig>;
	readonly data: StateData<TConfig, StateNames<TConfig>>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | TransportError | null;
	readonly connectionStatus?: "connected" | "reconnecting" | "disconnected";
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
		options?: { optimistic?: boolean },
	): Promise<DispatchResult<TConfig>>;
	match<R>(
		matchers: {
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		},
	): R;
	match<R>(
		matchers: Partial<{
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		}>,
		fallback: (workflow: Workflow<TConfig>) => R,
	): R;
}
```

**Important:** `@rytejs/sync` becomes an **optional peer dependency**. If `sync` option is not used, the import must not fail at runtime. Use `import type` for the type imports — these are erased at build time. The `SyncTransport` type in the options interface works because it's structural, and the actual `@rytejs/sync` package is only needed when a value is passed.

Add to `packages/react/package.json`:
```json
"peerDependencies": {
	"@rytejs/core": "workspace:^",
	"@rytejs/sync": "workspace:^"
},
"peerDependenciesMeta": {
	"@rytejs/sync": {
		"optional": true
	}
}
```

Also add `@rytejs/sync` to devDependencies:
```json
"devDependencies": {
	"@rytejs/sync": "workspace:^"
}
```

Then run: `pnpm install` to link the new workspace dependency.

- [ ] **Step 2: Write failing test for server-authoritative sync dispatch**

Add to `packages/react/__tests__/store.test.ts`:

```typescript
import { mockCommandTransport, mockUpdateTransport } from "@rytejs/sync/testing";
import { composeSyncTransport } from "@rytejs/sync";

describe("sync store", () => {
	test("throws when sync is provided without id", () => {
		const transport = composeSyncTransport({
			commands: mockCommandTransport(() => ({ ok: true, snapshot: {} as never, version: 1 })),
			updates: mockUpdateTransport(),
		});

		expect(() =>
			createWorkflowStore(router, { state: "Pending", data: { title: "Test" } }, { sync: transport }),
		).toThrow();
	});

	test("server-authoritative dispatch routes through transport", async () => {
		const snapshot = router.definition.snapshot(
			router.definition.createWorkflow("wf-1", { initialState: "Pending", data: { title: "Test" } }),
		);
		const handler = vi.fn().mockReturnValue({ ok: true, snapshot, version: 2 });
		const transport = composeSyncTransport({
			commands: mockCommandTransport(handler),
			updates: mockUpdateTransport(),
		});

		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ sync: transport },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		expect(handler).toHaveBeenCalledWith("wf-1", { type: "Start", payload: { assignee: "Alice" } });
	});

	test("server-authoritative dispatch updates workflow from server snapshot", async () => {
		const initial = router.definition.createWorkflow("wf-1", { initialState: "Pending", data: { title: "Test" } });
		const transitioned = router.definition.createWorkflow("wf-1", { initialState: "InProgress", data: { title: "Test", assignee: "Alice" } });
		const snapshot = router.definition.snapshot(transitioned);

		const transport = composeSyncTransport({
			commands: mockCommandTransport(() => ({ ok: true, snapshot, version: 2 })),
			updates: mockUpdateTransport(),
		});

		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ sync: transport },
		);

		const result = await store.dispatch("Start", { assignee: "Alice" });
		expect(store.getWorkflow().state).toBe("InProgress");
	});

	test("server-authoritative dispatch surfaces transport errors", async () => {
		const transport = composeSyncTransport({
			commands: mockCommandTransport(() => ({
				ok: false,
				error: { category: "transport", code: "NETWORK", message: "fail" },
			})),
			updates: mockUpdateTransport(),
		});

		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ sync: transport },
		);

		const result = await store.dispatch("Start", { assignee: "Alice" });
		expect(result.ok).toBe(false);
		expect(store.getSnapshot().error).toMatchObject({ category: "transport" });
	});
});
```

Note: These tests use the test router from `./helpers.ts` which defines: states `Pending` (title), `InProgress` (title, assignee), `Done` (title, completedAt); commands `Start` (assignee), `Complete` ({}), `Rename` (title); definition name `"todo"`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rytejs/react vitest run -- store`
Expected: FAIL — sync imports and new behavior not implemented.

- [ ] **Step 4: Update `packages/react/src/store.ts` with sync dispatch**

The key changes to `createWorkflowStore`:

1. At creation: if `sync` is provided and no `id`, throw.
2. Widen the `error` variable declaration from `PipelineError<TConfig> | null` to `PipelineError<TConfig> | TransportError | null` (line 32 of store.ts).
3. In `dispatch`: if `sync` is provided and `!options?.optimistic`, route through transport instead of local router.
4. Add `cleanup()` method.

The implementer should read the current `store.ts` code and modify the `dispatch` function. Here's the dispatch logic when sync is provided:

```typescript
const dispatch = async <C extends CommandNames<TConfig>>(
	command: C,
	payload: CommandPayload<TConfig, C>,
	dispatchOptions?: { optimistic?: boolean },
): Promise<DispatchResult<TConfig>> => {
	isDispatching = true;
	notify();

	// Sync: server-authoritative (default when sync is provided)
	if (options?.sync && !dispatchOptions?.optimistic) {
		const commandResult = await options.sync.dispatch(
			initialConfig.id!,
			{ type: command as string, payload },
		);

		if (commandResult.ok) {
			const restored = definition.restore(commandResult.snapshot);
			if (restored.ok) {
				workflow = restored.workflow;
				error = null;
				isDispatching = false;
				notify();
				return { ok: true, workflow: restored.workflow, events: [] } as DispatchResult<TConfig>;
			}
		}

		// Error path: pipeline error, transport error, or restore failure
		error = commandResult.ok
			? { category: "transport", code: "PARSE", message: "Failed to restore server snapshot" } as TransportError
			: commandResult.error;
		isDispatching = false;
		notify();
		return {
			ok: false,
			error,
		} as DispatchResult<TConfig>;
	}

	// Local dispatch (no sync, or optimistic — optimistic handled in Task 10)
	const result = await router.dispatch(workflow, { type: command, payload });
	// ... existing local dispatch logic ...
};
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rytejs/react vitest run`
Expected: All tests pass (existing + new sync tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @rytejs/react tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/types.ts packages/react/src/store.ts packages/react/package.json packages/react/__tests__/store.test.ts
git commit -m "feat(react): add sync transport support with server-authoritative dispatch"
```

---

## Task 9: React Subscription Wiring + Connection Status

**Files:**
- Modify: `packages/react/src/store.ts`
- Modify: `packages/react/src/use-workflow.ts`
- Modify: `packages/react/__tests__/store.test.ts`

- [ ] **Step 1: Write failing tests for subscription wiring**

Add to the `sync store` describe block in `packages/react/__tests__/store.test.ts`:

```typescript
test("subscribes to updates on store creation with sync", () => {
	const updates = mockUpdateTransport();
	const subscribeSpy = vi.spyOn(updates, "subscribe");
	const transport = composeSyncTransport({
		commands: mockCommandTransport(() => ({ ok: true, snapshot: {} as never, version: 1 })),
		updates,
	});

	const store = createWorkflowStore(
		router,
		{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
		{ sync: transport },
	);

	expect(subscribeSpy).toHaveBeenCalledWith("wf-1", expect.any(Function));
});

test("incoming update applies to store via setWorkflow", () => {
	const updates = mockUpdateTransport();
	const transport = composeSyncTransport({
		commands: mockCommandTransport(() => ({ ok: true, snapshot: {} as never, version: 1 })),
		updates,
	});

	const store = createWorkflowStore(
		router,
		{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
		{ sync: transport },
	);

	// Push an update
	const transitioned = router.definition.createWorkflow("wf-1", { initialState: "InProgress", data: { title: "Test", assignee: "Alice" } });
	const snapshot = router.definition.snapshot(transitioned);
	updates.push("wf-1", { snapshot, version: 2 });

	expect(store.getWorkflow().state).toBe("InProgress");
});

test("cleanup unsubscribes from updates", () => {
	const updates = mockUpdateTransport();
	const transport = composeSyncTransport({
		commands: mockCommandTransport(() => ({ ok: true, snapshot: {} as never, version: 1 })),
		updates,
	});

	const store = createWorkflowStore(
		router,
		{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
		{ sync: transport },
	);

	store.cleanup();

	// Push after cleanup — should not apply
	const transitioned = router.definition.createWorkflow("wf-1", { initialState: "InProgress", data: { title: "Test", assignee: "Alice" } });
	updates.push("wf-1", { snapshot: router.definition.snapshot(transitioned), version: 2 });

	expect(store.getWorkflow().state).toBe("Pending");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/react vitest run -- store`
Expected: FAIL — subscription wiring not implemented.

- [ ] **Step 3: Implement subscription wiring in `packages/react/src/store.ts`**

At the end of `createWorkflowStore`, before the return statement:

```typescript
// Sync subscription wiring
let syncSubscription: { unsubscribe(): void } | undefined;
if (options?.sync) {
	syncSubscription = options.sync.subscribe(initialConfig.id!, (message) => {
		const restored = definition.restore(message.snapshot);
		if (restored.ok) {
			workflow = restored.workflow;
			error = null;
			notify();
		} else {
			error = { category: "transport", code: "PARSE", message: "Failed to restore snapshot from server" } as TransportError;
			notify();
		}
	});
}
```

Add `cleanup()` to the return object:

```typescript
cleanup() {
	syncSubscription?.unsubscribe();
},
```

Import `TransportError` type at the top of the file:
```typescript
import type { TransportError } from "@rytejs/sync";
```

- [ ] **Step 4: Update `packages/react/src/use-workflow.ts` to pass connectionStatus**

Read the current `use-workflow.ts` and add `connectionStatus` to the return object. It comes from `snapshot.connectionStatus`:

```typescript
connectionStatus: snapshot.connectionStatus,
```

**Note:** `connectionStatus` is typed but not actively set in this plan. It will always be `undefined` for now. Full SSE connection state tracking (transport communicating `"connected"` / `"reconnecting"` / `"disconnected"` back to the store) is deferred to a follow-up — it requires the `UpdateTransport` interface to support a status callback, which is a design extension beyond the current spec's transport interface.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rytejs/react vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/store.ts packages/react/src/use-workflow.ts packages/react/__tests__/store.test.ts
git commit -m "feat(react): add subscription wiring and cleanup for sync stores"
```

---

## Task 10: React Optimistic Dispatch

**Files:**
- Modify: `packages/react/src/store.ts`
- Modify: `packages/react/__tests__/store.test.ts`

- [ ] **Step 1: Write failing tests for optimistic dispatch**

Add to the `sync store` describe block in `packages/react/__tests__/store.test.ts`:

```typescript
test("optimistic dispatch applies locally first, then confirms with server", async () => {
	const initial = router.definition.createWorkflow("wf-1", { initialState: "Pending", data: { title: "Test" } });
	const snapshot = router.definition.snapshot(initial);

	// Server responds successfully but slowly
	const handler = vi.fn().mockResolvedValue({ ok: true, snapshot, version: 2 });
	const transport = composeSyncTransport({
		commands: mockCommandTransport(handler),
		updates: mockUpdateTransport(),
	});

	const store = createWorkflowStore(
		router,
		{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
		{ sync: transport },
	);

	const result = await store.dispatch("Start", { assignee: "Alice" }, { optimistic: true });

	// Local dispatch was used — result comes from router
	expect(result.ok).toBeDefined();
	// Server was also called
	expect(handler).toHaveBeenCalled();
});

test("optimistic dispatch rolls back on server rejection", async () => {
	const transport = composeSyncTransport({
		commands: mockCommandTransport(() => ({
			ok: false,
			error: { category: "domain", code: "OutOfStock", data: {} },
		})),
		updates: mockUpdateTransport(),
	});

	const store = createWorkflowStore(
		router,
		{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
		{ sync: transport },
	);

	const originalState = store.getWorkflow().state;
	await store.dispatch("Start", { assignee: "Alice" }, { optimistic: true });

	// Should have rolled back
	expect(store.getWorkflow().state).toBe(originalState);
	expect(store.getSnapshot().error).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/react vitest run -- store`
Expected: FAIL — optimistic logic not implemented.

- [ ] **Step 3: Implement optimistic dispatch in `packages/react/src/store.ts`**

Add to the dispatch function, after the sync server-authoritative block:

```typescript
// Sync: optimistic dispatch
if (options?.sync && dispatchOptions?.optimistic) {
	const rollbackWorkflow = workflow;

	// 1. Dispatch locally for instant UI
	const localResult = await router.dispatch(workflow, { type: command, payload });
	if (localResult.ok) {
		workflow = localResult.workflow;
		error = null;
		notify();
	}

	// 2. Send to server in parallel
	const serverResult = await options.sync.dispatch(
		initialConfig.id!,
		{ type: command as string, payload },
	);

	if (!serverResult.ok) {
		// Rollback — use latest known server state if available,
		// otherwise the state before optimistic dispatch
		workflow = latestServerWorkflow ?? rollbackWorkflow;
		error = serverResult.error;
		isDispatching = false;
		notify();
		return {
			ok: false,
			error: error ?? { category: "unexpected", error: new Error("Server rejected"), message: "Server rejected" },
		} as DispatchResult<TConfig>;
	}

	isDispatching = false;
	notify();
	return localResult;
}
```

Add a `latestServerWorkflow` variable near the top of `createWorkflowStore` that gets updated by the subscription listener:

```typescript
let latestServerWorkflow: Workflow<TConfig> | undefined;
```

In the subscription listener, after `workflow = restored.workflow;`, add:
```typescript
latestServerWorkflow = restored.workflow;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rytejs/react vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/store.ts packages/react/__tests__/store.test.ts
git commit -m "feat(react): add optimistic dispatch with server reconciliation"
```

---

## Task 11: Final Verification and Build

**Files:** None new — verification only.

- [ ] **Step 1: Build sync package**

Run: `pnpm --filter @rytejs/sync build`
Expected: Build succeeds with three entry points.

- [ ] **Step 2: Build core (needed for react)**

Run: `pnpm --filter @rytejs/core tsup`
Expected: Build succeeds.

- [ ] **Step 3: Run all sync tests**

Run: `pnpm --filter @rytejs/sync vitest run`
Expected: All tests pass.

- [ ] **Step 4: Run all react tests**

Run: `pnpm --filter @rytejs/react vitest run`
Expected: All tests pass.

- [ ] **Step 5: Run full typecheck**

Run: `pnpm --filter @rytejs/sync tsc --noEmit && pnpm --filter @rytejs/react tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Run lint**

Run: `pnpm biome check packages/sync/ packages/react/`
Expected: No errors (or only auto-fixable ones).

- [ ] **Step 7: Fix any lint issues**

Run: `pnpm biome check --fix packages/sync/ packages/react/`

- [ ] **Step 8: Run full workspace check**

Run: `pnpm run check`
Expected: All packages pass typecheck + test + lint.

- [ ] **Step 9: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for sync package"
```
