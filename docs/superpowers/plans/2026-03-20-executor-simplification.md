# Executor Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the executor to its minimum — store required, middleware-only extension, no hooks/plugins/create/transport/HTTP.

**Architecture:** The executor becomes a thin IO shell: `load → middleware pipeline → dispatch → save`. Store is a required constructor param. Middleware is the single extension mechanism. All transport, HTTP, broadcast, and plugin code is deleted. Downstream packages (`@rytejs/otel`, `@rytejs/react`) are updated to match.

**Tech Stack:** TypeScript, Vitest, pnpm, tsup, VitePress

**Spec:** `docs/superpowers/specs/2026-03-20-executor-simplification-design.md`

---

### Task 1: Rename `engine/` → `store/`

Pure rename — no behavior change. Do this first so all subsequent tasks use the new paths.

**Files:**
- Rename: `packages/core/src/engine/` → `packages/core/src/store/`
- Modify: `packages/core/src/store/index.ts` (update if needed)
- Modify: `packages/core/tsup.config.ts:6` — change `src/engine/index.ts` → `src/store/index.ts`
- Modify: `packages/core/package.json:13-17` — change `./engine` → `./store` export key and paths
- Modify: All files importing from `../engine/` or `@rytejs/core/engine` within `packages/core/src/`

- [ ] **Step 1: Rename the directory**

```bash
mv packages/core/src/engine packages/core/src/store
```

- [ ] **Step 2: Update internal imports within `packages/core/src/`**

Find all files importing from `../engine/` and update to `../store/`:

- `packages/core/src/executor/with-store.ts:1` — `../engine/errors.js` → `../store/errors.js`
- `packages/core/src/executor/with-store.ts:2` — `../engine/types.js` → `../store/types.js`
- `packages/core/src/executor/types.ts:1` — `../engine/types.js` → `../store/types.js`
- `packages/core/src/http/http.ts:1` — `../engine/types.js` → `../store/types.js`
- `packages/core/src/transport/server/polling.ts:1` — `../../engine/types.js` → `../../store/types.js`

- [ ] **Step 3: Update tsup.config.ts entry**

Change `"src/engine/index.ts"` → `"src/store/index.ts"`.

- [ ] **Step 4: Update package.json export map**

Change the `"./engine"` key to `"./store"` and update all paths from `dist/engine/` to `dist/store/`.

- [ ] **Step 5: Update test imports**

Find all test files importing from `../../src/engine/`:

- `packages/core/__tests__/executor/with-store.test.ts` — if it imports from engine
- `packages/core/__tests__/integration/executor-integration.test.ts:2` — `../../src/engine/memory-store.js` → `../../src/store/memory-store.js`

- [ ] **Step 6: Build and verify**

```bash
pnpm --filter @rytejs/core tsup && pnpm --filter @rytejs/core vitest run
```

Expected: All 149 tests pass. Build succeeds with new `dist/store/` output.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: rename engine/ to store/"
```

---

### Task 2: Delete transport, HTTP, and broadcast files

Remove all files that are being deleted. Do this before the executor rewrite to reduce noise.

**Files:**
- Delete: `packages/core/src/http/` (entire directory)
- Delete: `packages/core/src/transport/` (entire directory)
- Delete: `packages/core/src/executor/plugin.ts`
- Delete: `packages/core/src/executor/with-store.ts`
- Delete: `packages/core/src/executor/with-broadcast.ts`
- Delete: `packages/core/__tests__/executor/plugin.test.ts`
- Delete: `packages/core/__tests__/executor/with-store.test.ts`
- Delete: `packages/core/__tests__/executor/with-broadcast.test.ts`
- Delete: `packages/core/__tests__/executor/outbox.test.ts`
- Delete: `packages/core/__tests__/executor/sqlite-store.ts` (test helper for outbox)
- Delete: `packages/core/__tests__/integration/executor-integration.test.ts`

- [ ] **Step 1: Delete the directories and files**

```bash
rm -rf packages/core/src/http packages/core/src/transport
rm packages/core/src/executor/plugin.ts
rm packages/core/src/executor/with-store.ts
rm packages/core/src/executor/with-broadcast.ts
rm packages/core/__tests__/executor/plugin.test.ts
rm packages/core/__tests__/executor/with-store.test.ts
rm packages/core/__tests__/executor/with-broadcast.test.ts
rm packages/core/__tests__/executor/outbox.test.ts
rm packages/core/__tests__/executor/sqlite-store.ts
rm packages/core/__tests__/integration/executor-integration.test.ts
```

- [ ] **Step 2: Update tsup.config.ts — remove deleted entry points**

Remove these entries from the `entry` array:
- `"src/http/index.ts"`
- `"src/transport/index.ts"`
- `"src/transport/server/index.ts"`

Final entry array should be:
```ts
entry: [
	"src/index.ts",
	"src/store/index.ts",
	"src/reactor/index.ts",
	"src/executor/index.ts",
],
```

- [ ] **Step 3: Update package.json — remove deleted export maps**

Remove these export keys:
- `"./http"`
- `"./transport"`
- `"./transport/server"`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: delete transport, HTTP, broadcast, and plugin files"
```

Note: Build will fail at this point because executor.ts still imports from deleted files. That's expected — Task 3 fixes it.

---

### Task 3: Rewrite executor types

Simplify the type file to match the new design.

**Files:**
- Rewrite: `packages/core/src/executor/types.ts`

- [ ] **Step 1: Rewrite types.ts**

```ts
import type { WorkflowSnapshot } from "../snapshot.js";
import type { DispatchResult, PipelineError, WorkflowConfig } from "../types.js";
import type { StoredWorkflow } from "../store/types.js";

// ── Context ──

export interface ExecutorContext {
	readonly id: string;
	readonly command: { type: string; payload: unknown };
	readonly stored: StoredWorkflow;

	result: DispatchResult<WorkflowConfig> | { ok: false; error: ExecutorError } | null;
	snapshot: WorkflowSnapshot | null;
	events: Array<{ type: string; data: unknown }>;
}

// ── Middleware ──

export type ExecutorMiddleware = (ctx: ExecutorContext, next: () => Promise<void>) => Promise<void>;

// ── Errors ──

export type ExecutorError =
	| { category: "not_found"; id: string }
	| { category: "conflict"; id: string; expectedVersion: number; actualVersion: number }
	| { category: "restore"; id: string; issues: unknown[] }
	| { category: "unexpected"; error: unknown; message: string };

// ── Result ──

export type ExecutionResult =
	| {
			ok: true;
			snapshot: WorkflowSnapshot;
			version: number;
			events: Array<{ type: string; data: unknown }>;
	  }
	| {
			ok: false;
			error: PipelineError<WorkflowConfig> | ExecutorError;
	  };
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/executor/types.ts && git commit -m "refactor: simplify executor types"
```

---

### Task 4: Rewrite executor class

The core rewrite — store required, no hooks, no plugins, no create().

**Files:**
- Rewrite: `packages/core/src/executor/executor.ts`

- [ ] **Step 1: Rewrite executor.ts**

```ts
import { compose } from "../compose.js";
import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import { ConcurrencyConflictError } from "../store/errors.js";
import type { StoreAdapter } from "../store/types.js";
import type { WorkflowConfig } from "../types.js";
import type {
	ExecutionResult,
	ExecutorContext,
	ExecutorMiddleware,
} from "./types.js";

export class WorkflowExecutor<TConfig extends WorkflowConfig> {
	private readonly middleware: ExecutorMiddleware[] = [];

	constructor(
		public readonly router: WorkflowRouter<TConfig>,
		private readonly store: StoreAdapter,
	) {}

	use(middleware: ExecutorMiddleware): this {
		this.middleware.push(middleware);
		return this;
	}

	async execute(
		id: string,
		command: { type: string; payload: unknown },
		options?: { expectedVersion?: number },
	): Promise<ExecutionResult> {
		// 1. Load
		const stored = await this.store.load(id);
		if (!stored) {
			return { ok: false, error: { category: "not_found", id } };
		}

		// 2. Optimistic version check
		if (options?.expectedVersion !== undefined && options.expectedVersion !== stored.version) {
			return {
				ok: false,
				error: {
					category: "conflict",
					id,
					expectedVersion: options.expectedVersion,
					actualVersion: stored.version,
				},
			};
		}

		// 3. Build context
		const ctx: ExecutorContext = {
			id,
			command,
			stored,
			result: null,
			snapshot: null,
			events: [],
		};

		// 4. Run pipeline
		try {
			const chain = [...this.middleware, this.dispatchHandler()];
			await compose(chain)(ctx);
		} catch (err) {
			return {
				ok: false,
				error: {
					category: "unexpected",
					error: err,
					message: err instanceof Error ? err.message : String(err),
				},
			};
		}

		// 5. Save if dispatch succeeded
		if (ctx.snapshot) {
			try {
				await this.store.save({
					id,
					snapshot: ctx.snapshot,
					expectedVersion: stored.version,
					events: ctx.events,
				});
			} catch (err) {
				if (err instanceof ConcurrencyConflictError) {
					return {
						ok: false,
						error: {
							category: "conflict",
							id,
							expectedVersion: stored.version,
							actualVersion: err.actualVersion,
						},
					};
				}
				return {
					ok: false,
					error: {
						category: "unexpected",
						error: err,
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}

			return {
				ok: true,
				snapshot: ctx.snapshot,
				version: stored.version + 1,
				events: ctx.events,
			};
		}

		// 6. Dispatch failed — return the error
		if (ctx.result && !ctx.result.ok) {
			return { ok: false, error: ctx.result.error };
		}

		return {
			ok: false,
			error: {
				category: "unexpected",
				error: new Error("Pipeline completed without setting snapshot or error"),
				message: "Pipeline completed without setting snapshot or error",
			},
		};
	}

	private dispatchHandler(): ExecutorMiddleware {
		const definition = this.router.definition;
		const router = this.router;

		return async (ctx, _next) => {
			const restoreResult = definition.restore(ctx.stored.snapshot);
			if (!restoreResult.ok) {
				ctx.result = {
					ok: false as const,
					error: {
						category: "restore" as const,
						id: ctx.id,
						issues: restoreResult.error.issues,
					},
				};
				return;
			}

			// as never: type erasure — executor holds WorkflowConfig base type,
			// but dispatch validates commands against Zod schemas at runtime
			const dispatchResult = await router.dispatch(restoreResult.workflow, ctx.command as never);

			// biome-ignore lint/suspicious/noExplicitAny: type erasure — DispatchResult<TConfig> assigned to DispatchResult<WorkflowConfig>
			ctx.result = dispatchResult as any;

			if (dispatchResult.ok) {
				// biome-ignore lint/suspicious/noExplicitAny: type erasure — TConfig narrows WorkflowSnapshot but ctx.snapshot is unparameterized
				ctx.snapshot = definition.snapshot(dispatchResult.workflow) as any as WorkflowSnapshot;
				ctx.events = (dispatchResult.events as Array<{ type: string; data: unknown }>).map(
					(e) => ({
						type: e.type,
						data: e.data,
					}),
				);
			}
		};
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/executor/executor.ts && git commit -m "refactor: rewrite executor — store required, no hooks/plugins/create"
```

---

### Task 5: Update executor index.ts

Reduce the export surface.

**Files:**
- Rewrite: `packages/core/src/executor/index.ts`

- [ ] **Step 1: Rewrite index.ts**

```ts
export { WorkflowExecutor } from "./executor.js";
export type {
	ExecutionResult,
	ExecutorContext,
	ExecutorError,
	ExecutorMiddleware,
} from "./types.js";
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @rytejs/core tsup
```

Expected: Build succeeds. `dist/executor/` contains only the executor class and simplified types.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/executor/index.ts && git commit -m "refactor: reduce executor exports"
```

---

### Task 6: Remove `EmittedEvent` from store exports

Dead type — exported but never imported outside `store/`.

**Files:**
- Modify: `packages/core/src/store/types.ts` — delete `EmittedEvent` interface
- Modify: `packages/core/src/store/index.ts` — remove `EmittedEvent` from exports

- [ ] **Step 1: Delete EmittedEvent from types.ts**

Remove lines 20-23:
```ts
export interface EmittedEvent {
	type: string;
	data: unknown;
}
```

- [ ] **Step 2: Remove from index.ts export**

Remove `EmittedEvent` from the type export list in `packages/core/src/store/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/store/ && git commit -m "refactor: remove dead EmittedEvent type"
```

---

### Task 7: Write executor tests

TDD — write tests for the new API, verify they pass against the implementation.

**Files:**
- Rewrite: `packages/core/__tests__/executor/executor.test.ts`
- Keep: `packages/core/__tests__/executor/helpers.ts` (test fixtures — still valid)

- [ ] **Step 1: Rewrite executor.test.ts**

```ts
import { describe, expect, test, vi } from "vitest";
import { memoryStore } from "../../src/store/memory-store.js";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import type { ExecutorContext, ExecutorMiddleware } from "../../src/executor/types.js";
import { createTestRouter, definition } from "./helpers.js";

function seed(store: ReturnType<typeof memoryStore>, id: string, data: { items: string[] }) {
	const workflow = definition.createWorkflow(id, {
		initialState: "Draft",
		data,
	});
	const snapshot = definition.snapshot(workflow);
	return store.save({ id, snapshot, expectedVersion: 0 });
}

describe("WorkflowExecutor", () => {
	describe("execute", () => {
		test("loads, dispatches, and saves", async () => {
			const store = memoryStore();
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router, store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.snapshot.state).toBe("Placed");
			expect(result.version).toBe(2);
			expect(result.events).toHaveLength(1);
			expect(result.events[0].type).toBe("OrderPlaced");
		});

		test("returns not_found when workflow does not exist", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			const result = await executor.execute("nonexistent", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("not_found");
		});

		test("returns domain error from handler", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: [] });

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("domain");
		});

		test("returns validation error for unknown command", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute("order-1", {
				type: "NonExistent",
				payload: {},
			});

			expect(result.ok).toBe(false);
		});
	});

	describe("expectedVersion", () => {
		test("succeeds when expectedVersion matches stored version", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute(
				"order-1",
				{ type: "AddItem", payload: { item: "gadget" } },
				{ expectedVersion: 1 },
			);

			expect(result.ok).toBe(true);
		});

		test("returns conflict when expectedVersion does not match", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			const result = await executor.execute(
				"order-1",
				{ type: "AddItem", payload: { item: "gadget" } },
				{ expectedVersion: 99 },
			);

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("conflict");
			if (result.error.category !== "conflict") return;
			expect(result.error.expectedVersion).toBe(99);
			expect(result.error.actualVersion).toBe(1);
		});
	});

	describe("concurrency", () => {
		test("one write succeeds, concurrent write gets conflict", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["a"] });

			const [r1, r2] = await Promise.all([
				executor.execute("order-1", { type: "AddItem", payload: { item: "b" } }),
				executor.execute("order-1", { type: "AddItem", payload: { item: "c" } }),
			]);

			const successes = [r1, r2].filter((r) => r.ok);
			const failures = [r1, r2].filter((r) => !r.ok);
			expect(successes).toHaveLength(1);
			expect(failures).toHaveLength(1);
		});
	});

	describe("middleware", () => {
		test("executes in onion order", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);
			const order: string[] = [];

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (_ctx, next) => {
				order.push("A:before");
				await next();
				order.push("A:after");
			});
			executor.use(async (_ctx, next) => {
				order.push("B:before");
				await next();
				order.push("B:after");
			});

			await executor.execute("order-1", { type: "AddItem", payload: { item: "x" } });

			expect(order).toEqual(["A:before", "B:before", "B:after", "A:after"]);
		});

		test("middleware sees stored workflow on context", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);
			let captured: ExecutorContext | null = null;

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (ctx, next) => {
				captured = ctx;
				await next();
			});

			await executor.execute("order-1", { type: "AddItem", payload: { item: "x" } });

			expect(captured).not.toBeNull();
			expect(captured!.stored.snapshot.state).toBe("Draft");
			expect(captured!.stored.version).toBe(1);
		});

		test("middleware can short-circuit by not calling next", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (ctx, _next) => {
				ctx.result = {
					ok: false as const,
					error: { category: "not_found" as const, id: ctx.id },
				};
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			// Verify nothing was saved (version unchanged)
			const loaded = await store.load("order-1");
			expect(loaded!.version).toBe(1);
		});

		test("use() returns this for chaining", () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			const returned = executor.use(async (_ctx, next) => {
				await next();
			});
			expect(returned).toBe(executor);
		});
	});

	describe("error boundary", () => {
		test("catches unexpected middleware errors", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async () => {
				throw new Error("kaboom");
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("unexpected");
		});

		test("execute never throws", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async () => {
				throw new Error("kaboom");
			});

			// Should not throw — returns error result
			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		test("does not save when middleware throws", async () => {
			const store = memoryStore();
			const executor = new WorkflowExecutor(createTestRouter(), store);

			await seed(store, "order-1", { items: ["widget"] });

			executor.use(async (_ctx, next) => {
				await next();
				throw new Error("post-dispatch error");
			});

			await executor.execute("order-1", { type: "AddItem", payload: { item: "x" } });

			// Version should be unchanged — error prevented save
			const loaded = await store.load("order-1");
			expect(loaded!.version).toBe(1);
		});
	});
});
```

- [ ] **Step 2: Update helpers.ts import**

Change `../../src/definition.js` and `../../src/router.js` imports if needed (they should be unchanged since engine→store doesn't affect these).

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @rytejs/core vitest run __tests__/executor/
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/__tests__/executor/ && git commit -m "test: rewrite executor tests for simplified API"
```

---

### Task 8: Update `@rytejs/otel` executor plugin → middleware

The otel executor plugin uses `defineExecutorPlugin` and hooks. Convert to a middleware function.

**Files:**
- Rewrite: `packages/otel/src/executor.ts`
- Rewrite: `packages/otel/src/__tests__/executor.test.ts` — tests use old plugin/hooks API
- Modify: `packages/otel/src/index.ts` — update export name if changed

- [ ] **Step 1: Check current otel index.ts exports**

Read `packages/otel/src/index.ts` to see what's exported.

- [ ] **Step 2: Rewrite executor.ts as middleware**

```ts
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { ExecutorContext, ExecutorMiddleware } from "@rytejs/core/executor";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_RESULT,
	ATTR_WORKFLOW_ID,
	SCOPE_NAME,
} from "./conventions.js";

export interface OtelExecutorMiddlewareOptions {
	tracerName?: string;
}

export function createOtelExecutorMiddleware(
	options?: OtelExecutorMiddlewareOptions,
): ExecutorMiddleware {
	const tracerName = options?.tracerName ?? SCOPE_NAME;

	return async (ctx: ExecutorContext, next: () => Promise<void>) => {
		const tracer = trace.getTracer(tracerName);
		const spanName = `ryte.execute.${ctx.command.type}`;

		const span = tracer.startSpan(spanName);
		span.setAttribute(ATTR_WORKFLOW_ID, ctx.id);
		span.setAttribute(ATTR_COMMAND_TYPE, ctx.command.type);

		try {
			await next();

			if (ctx.snapshot) {
				span.setAttribute(ATTR_RESULT, "ok");
				span.setStatus({ code: SpanStatusCode.OK });
			} else if (ctx.result && !ctx.result.ok) {
				span.setAttribute(ATTR_RESULT, "error");
				span.setAttribute(ATTR_ERROR_CATEGORY, ctx.result.error.category);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: ctx.result.error.category,
				});
			}
		} catch (err) {
			span.setAttribute(ATTR_RESULT, "error");
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err),
			});
			throw err;
		} finally {
			span.end();
		}
	};
}
```

- [ ] **Step 3: Update otel index.ts**

Replace `createOtelExecutorPlugin` export with `createOtelExecutorMiddleware`. Keep the old name as a deprecated re-export if desired, or just rename.

- [ ] **Step 4: Rewrite otel executor tests**

Rewrite `packages/otel/src/__tests__/executor.test.ts` to test the middleware function instead of the plugin/hooks API. The tests should verify:
- Middleware creates and ends a span around `next()`
- Span gets `ryte.execute.{type}` name with correct attributes
- Success sets OK status
- Dispatch error sets ERROR status with error category
- Middleware re-throws errors after recording them on the span

- [ ] **Step 5: Build core, then run otel typecheck and tests**

```bash
pnpm --filter @rytejs/core tsup && pnpm --filter @rytejs/otel tsc --noEmit && pnpm --filter @rytejs/otel vitest run
```

Expected: Typecheck and tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/otel/ && git commit -m "refactor: convert otel executor plugin to middleware"
```

---

### Task 9: Update `@rytejs/react` — move Transport types

The React package imports `Transport` and `BroadcastMessage` from `@rytejs/core/transport`, which no longer exists. These types belong in the React package since it's the only consumer.

**Files:**
- Create: `packages/react/src/transport.ts` — Transport types moved here
- Modify: `packages/react/src/types.ts` — import from local `./transport.js`
- Modify: `packages/react/src/store.ts` — import from local `./transport.js`
- Modify: `packages/react/__tests__/transport-store.test.ts` — update import
- Modify: `packages/react/src/index.ts` — export Transport types if not already

- [ ] **Step 1: Create transport.ts in react package**

```ts
import type { WorkflowSnapshot } from "@rytejs/core";

export interface BroadcastMessage {
	snapshot: WorkflowSnapshot;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

export interface Transport {
	dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult>;

	subscribe(id: string, callback: (message: BroadcastMessage) => void): TransportSubscription;
}

export type TransportResult =
	| {
			ok: true;
			snapshot: WorkflowSnapshot;
			version: number;
			events: Array<{ type: string; data: unknown }>;
	  }
	| {
			ok: false;
			error: TransportError;
	  };

export interface TransportError {
	category: "transport";
	code: "NETWORK" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT";
	message: string;
}

export interface TransportSubscription {
	unsubscribe(): void;
}
```

Note: `TransportResult` error type simplified — no longer unions with `PipelineError` since that was a `@rytejs/core` internal type that shouldn't leak into the transport contract. The React store already handles the error generically.

- [ ] **Step 2: Update imports in types.ts**

Change `import type { Transport } from "@rytejs/core/transport"` → `import type { Transport } from "./transport.js"`.

- [ ] **Step 3: Update imports in store.ts**

Change `import type { BroadcastMessage } from "@rytejs/core/transport"` → `import type { BroadcastMessage } from "./transport.js"`.

- [ ] **Step 4: Update test imports**

Change `import type { BroadcastMessage } from "@rytejs/core/transport"` → `import type { BroadcastMessage } from "../../src/transport.js"` in `packages/react/__tests__/transport-store.test.ts`.

- [ ] **Step 5: Export Transport types from react index.ts**

Add to `packages/react/src/index.ts`:
```ts
export type { Transport, TransportResult, TransportError, TransportSubscription, BroadcastMessage } from "./transport.js";
```

- [ ] **Step 6: Build core, then typecheck react**

```bash
pnpm --filter @rytejs/core tsup && pnpm --filter @rytejs/react tsc --noEmit
```

Expected: Typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add packages/react/ && git commit -m "refactor: move Transport types from core to react package"
```

---

### Task 10: Update `examples/otel`

The example imports from `@rytejs/core/engine` (uses `createEngine` which no longer exists) and `@rytejs/core/http` (uses `createHandler` which is deleted). This example needs a **full rewrite** — not just import changes — because the Engine/Handler pattern is removed entirely.

**Files:**
- Rewrite: `examples/otel/src/index.ts` — use `WorkflowExecutor` with store constructor + manual HTTP handler
- Modify: `examples/otel/README.md` — remove `@rytejs/core/http` reference

Since the example is NOT in the workspace (`examples/` is standalone and installs from npm), this change will only matter at next npm publish. Still, update it for consistency.

- [ ] **Step 1: Read the current file**

Read `examples/otel/src/index.ts` and `examples/otel/README.md` to understand the full context.

- [ ] **Step 2: Rewrite `examples/otel/src/index.ts`**

Replace the `createEngine`/`createHandler` pattern with `WorkflowExecutor(router, store)` and a manual HTTP handler using the `Request`/`Response` pattern. Import from `@rytejs/core/store` instead of `@rytejs/core/engine`. Use `createOtelExecutorMiddleware` instead of `createOtelExecutorPlugin`.

- [ ] **Step 3: Update README.md**

Remove references to `@rytejs/core/http`.

- [ ] **Step 4: Commit**

```bash
git add examples/ && git commit -m "chore: rewrite otel example for simplified executor API"
```

---

### Task 11: Full build and test

Verify everything compiles and passes.

**Files:** None — verification only.

- [ ] **Step 1: Build core**

```bash
pnpm --filter @rytejs/core tsup
```

Expected: Build succeeds.

- [ ] **Step 2: Run core tests**

```bash
pnpm --filter @rytejs/core vitest run
```

Expected: All tests pass (some tests will have been removed, remaining tests pass).

- [ ] **Step 3: Typecheck everything**

```bash
pnpm --filter @rytejs/core tsc --noEmit
```

Expected: Clean.

- [ ] **Step 4: Lint**

```bash
pnpm biome check .
```

Expected: Clean (or only pre-existing issues).

- [ ] **Step 5: Commit if any fixes were needed**

---

### Task 12: Delete infrastructure docs and snippets

**Files:**
- Delete: `docs/guide/persistence.md`
- Delete: `docs/guide/http-api.md`
- Delete: `docs/guide/real-time.md`
- Delete: `docs/guide/transports.md`
- Delete: `docs/guide/putting-it-together.md`
- Delete: `docs/snippets/guide/persistence.ts`
- Delete: `docs/snippets/guide/http-api.ts`
- Delete: `docs/snippets/guide/real-time.ts`
- Delete: `docs/snippets/guide/transports.ts`
- Delete: `docs/snippets/guide/putting-it-together.ts`

- [ ] **Step 1: Delete the files**

```bash
rm docs/guide/persistence.md docs/guide/http-api.md docs/guide/real-time.md docs/guide/transports.md docs/guide/putting-it-together.md
rm docs/snippets/guide/persistence.ts docs/snippets/guide/http-api.ts docs/snippets/guide/real-time.ts docs/snippets/guide/transports.ts docs/snippets/guide/putting-it-together.ts
```

- [ ] **Step 2: Update sidebar in config.ts**

Remove the entire "Infrastructure" section from the sidebar in `docs/.vitepress/config.ts` (lines 56-65):

```ts
{
	text: "Infrastructure",
	items: [
		{ text: "Persistence", link: "/guide/persistence" },
		{ text: "HTTP API", link: "/guide/http-api" },
		{ text: "Real-time", link: "/guide/real-time" },
		{ text: "Transports", link: "/guide/transports" },
		{ text: "Putting It Together", link: "/guide/putting-it-together" },
	],
},
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: delete infrastructure pages and snippets"
```

---

### Task 13: Rewrite executor docs and snippet

**Files:**
- Rewrite: `docs/guide/executor.md`
- Rewrite: `docs/snippets/guide/executor.ts`
- Modify: `docs/snippets/guide/observability-otel.ts` — update executor examples

- [ ] **Step 1: Rewrite executor.ts snippet**

Update to use new API: store in constructor, no `withStore`, no `create()`, import from `@rytejs/core/store`:

```ts
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/store";
import { ConcurrencyConflictError, memoryStore } from "@rytejs/core/store";
import { WorkflowExecutor } from "@rytejs/core/executor";
import type { ExecutorMiddleware } from "@rytejs/core/executor";
import { taskDefinition, taskRouter } from "../fixtures.js";

// #region adapters
const pgStore: StoreAdapter = {
	async load(id: string): Promise<StoredWorkflow | null> {
		// SELECT snapshot, version FROM workflows WHERE id = $1
		throw new Error(`Not implemented: load(${id})`);
	},
	async save(options: SaveOptions): Promise<void> {
		// UPDATE workflows SET snapshot = $2, version = version + 1
		//   WHERE id = $1 AND version = $3
		// Throw ConcurrencyConflictError if rowCount === 0
		throw new Error(`Not implemented: save(${options.id})`);
	},
};
// #endregion adapters

// #region memory-store
const store = memoryStore();
// #endregion memory-store

// #region create-executor
const executor = new WorkflowExecutor(taskRouter, store);
// #endregion create-executor

// #region execute
(async () => {
	const result = await executor.execute("task-1", {
		type: "Start",
		payload: { assignee: "alice" },
	});

	if (result.ok) {
		console.log(result.snapshot); // WorkflowSnapshot with state "InProgress"
		console.log(result.events); // [{ type: "TaskStarted", ... }]
		console.log(result.version); // 2
	} else {
		console.log(result.error);
	}
})();
// #endregion execute

// #region expected-version
(async () => {
	const result = await executor.execute(
		"task-1",
		{ type: "Start", payload: { assignee: "alice" } },
		{ expectedVersion: 1 },
	);

	if (!result.ok && result.error.category === "conflict") {
		console.log("Stale version — reload and retry");
	}
})();
// #endregion expected-version

// #region middleware
const authMiddleware: ExecutorMiddleware = async (ctx, next) => {
	// Middleware sees the loaded workflow — check permissions
	const ownerField = (ctx.stored.snapshot.data as { owner?: string }).owner;
	if (ownerField !== "current-user") {
		ctx.result = {
			ok: false as const,
			error: { category: "not_found" as const, id: ctx.id },
		};
		return; // short-circuit — don't call next()
	}
	await next();
};

executor.use(authMiddleware);
// #endregion middleware

// #region error-handling
(async () => {
	try {
		await pgStore.save({
			id: "task-1",
			snapshot: {} as Parameters<typeof pgStore.save>[0]["snapshot"],
			expectedVersion: 1,
		});
	} catch (err) {
		if (err instanceof ConcurrencyConflictError) {
			console.log("Conflict:", err.workflowId, err.expectedVersion, err.actualVersion);
		}
	}
})();
// #endregion error-handling

void pgStore;
```

- [ ] **Step 2: Rewrite executor.md**

```markdown
# Executor

The `WorkflowExecutor` is the IO shell around the pure router: **load → dispatch → save**. It takes a router and a store, runs your middleware pipeline, and handles concurrency.

## Store Interface

The executor delegates persistence to the `StoreAdapter` interface:

| Method | Responsibility |
| --- | --- |
| `load(id)` | Load a workflow snapshot by ID |
| `save(options)` | Persist a snapshot with optimistic concurrency |

`save()` takes an `expectedVersion` for optimistic concurrency control — throw `ConcurrencyConflictError` if the stored version doesn't match.

<<< @/snippets/guide/executor.ts#adapters

## Memory Store

For testing and prototyping, use the built-in memory store:

<<< @/snippets/guide/executor.ts#memory-store

## Creating an Executor

Pass a router and a store to the constructor:

<<< @/snippets/guide/executor.ts#create-executor

## Executing Commands

`executor.execute()` loads the workflow, runs the middleware pipeline, dispatches the command, saves the result, and returns:

<<< @/snippets/guide/executor.ts#execute

## Optimistic Locking

Pass `expectedVersion` to reject stale writes early:

<<< @/snippets/guide/executor.ts#expected-version

## Middleware

Middleware runs after the workflow is loaded but before the save. Use it for auth, logging, rate limiting, or any cross-cutting concern that needs access to the stored workflow:

<<< @/snippets/guide/executor.ts#middleware

Middleware executes in Koa-style onion order — the first middleware added wraps the rest.

## Error Handling

Dispatch errors (domain, validation, router) are returned inside `ExecutionResult`, never thrown. Store adapters throw `ConcurrencyConflictError` for optimistic locking failures at the database level:

<<< @/snippets/guide/executor.ts#error-handling
```

- [ ] **Step 3: Update observability-otel.ts snippet**

Update the executor sections to use `createOtelExecutorMiddleware` instead of `createOtelExecutorPlugin`, and pass store to constructor. Specific changes in `docs/snippets/guide/observability-otel.ts`:

- Line 3: `import { createOtelExecutorPlugin, ...}` → `import { createOtelExecutorMiddleware, ...}`
- Line 27: `new WorkflowExecutor(taskRouter)` → `new WorkflowExecutor(taskRouter, store)` (add `import { memoryStore } from "@rytejs/core/store"` and `const store = memoryStore()`)
- Line 28: `executor.use(createOtelExecutorPlugin())` → `executor.use(createOtelExecutorMiddleware())`
- Lines 31-33: Remove comment about `ryte.create spans for create()` — only `execute()` exists now
- Line 42: `new WorkflowExecutor(tracedRouter)` → `new WorkflowExecutor(tracedRouter, store)`
- Line 43: `tracedExecutor.use(createOtelExecutorPlugin())` → `tracedExecutor.use(createOtelExecutorMiddleware())`

- [ ] **Step 4: Update observability.md**

In `docs/guide/observability.md`:
- Update text referencing `createOtelExecutorPlugin` → `createOtelExecutorMiddleware`
- Remove references to `create()` operations
- Update any `execute:start`/`execute:end` hook references to describe middleware-based tracing

- [ ] **Step 5: Update React docs and snippet**

`docs/snippets/guide/react.ts` imports from `@rytejs/core/transport` (lines 16-17: `Transport` type and `sseTransport` function). Since `@rytejs/core/transport` is deleted and `sseTransport` no longer exists:

- Update `import type { Transport } from "@rytejs/core/transport"` → `import type { Transport } from "@rytejs/react"` (moved in Task 9)
- Remove `import { sseTransport } from "@rytejs/core/transport"` — provide an inline example transport or remove the `#transport-store` and `#transport-cleanup` regions

In `docs/guide/react.md`:
- Update or remove the "Transport" section (lines ~94-118) that references `@rytejs/core/transport`
- Remove the "Next Steps" link to `/guide/transports` (page is deleted)

- [ ] **Step 6: Typecheck doc snippets**

```bash
pnpm --filter @rytejs/docs typecheck
```

Expected: Passes. If fixtures need updating (e.g., `taskRouter` needs a `taskDefinition` export), fix them.

- [ ] **Step 6: Commit**

```bash
git add docs/ && git commit -m "docs: rewrite executor docs for simplified API"
```

---

### Task 14: Final verification and push

- [ ] **Step 1: Run full check**

```bash
pnpm run check
```

Expected: Typecheck + tests + lint all pass.

- [ ] **Step 2: Push**

```bash
git push
```
