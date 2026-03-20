# Executor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ExecutionEngine` with a composable `WorkflowExecutor` class that uses middleware pipelines, and prove the outbox pattern with a transactional SQLite store.

**Architecture:** `WorkflowExecutor` wraps `router.dispatch()` with pluggable middleware (Koa-style onion model, reusing existing `compose()`). `withStore` handles persistence + outbox. `withBroadcast` handles subscriber notification. The executor never throws — result pattern at every layer. A `sqliteStore()` adapter using `better-sqlite3` provides in-memory transactional storage for tests.

**Tech Stack:** TypeScript, Vitest, Zod v4, `better-sqlite3` (dev dep, for test store), existing `compose()` from core

**Convention:** Every task ends with `git commit` then `git push` per project rules. Don't batch pushes. Push commands are omitted from individual steps for brevity — always push after each commit.

**Spec:** `docs/superpowers/specs/2026-03-19-executor-transport-design.md`

---

## Scope

This plan covers the executor core only:

1. Executor types (`ExecutorContext`, `ExecutorMiddleware`, `ExecutionResult`, `ExecutorError`)
2. `WorkflowExecutor` class (use, on, execute, create)
3. `defineExecutorPlugin`
4. `withStore` middleware
5. `withBroadcast` middleware + `createSubscriberRegistry`
6. `sqliteStore()` — transactional test store with outbox
7. `SaveOptions.events` extension
8. `createFetch` (replaces `createHandler`)
9. Remove old engine code
10. Update exports

**NOT in scope** (follow-up plan): Transport implementations (WS, SSE, polling), server-side transport helpers, React store transport integration, otel executor plugin.

## File Structure

```
packages/core/src/
├── executor/
│   ├── index.ts                    Entry point — exports all executor public API
│   ├── types.ts                    ExecutorContext, ExecutorMiddleware, ExecutionResult, ExecutorError, BroadcastMessage
│   ├── executor.ts                 WorkflowExecutor class
│   ├── plugin.ts                   defineExecutorPlugin, isExecutorPlugin, ExecutorPlugin type
│   ├── with-store.ts               withStore middleware factory
│   └── with-broadcast.ts           withBroadcast middleware + createSubscriberRegistry
├── engine/
│   ├── types.ts                    MODIFY: add events? to SaveOptions
│   ├── errors.ts                   MODIFY: remove LockConflictError, keep ConcurrencyConflictError
│   ├── memory-store.ts             KEEP: unchanged (events field is optional, ignored)
│   ├── index.ts                    MODIFY: update exports
│   ├── engine.ts                   DELETE
│   ├── memory-adapter.ts           DELETE
│   ├── memory-lock.ts              DELETE
│   └── memory-queue.ts             DELETE
├── http/
│   ├── handler.ts                  DELETE
│   ├── http.ts                     NEW: createFetch
│   ├── types.ts                    MODIFY: update types for createFetch
│   └── index.ts                    MODIFY: update exports
├── transport/
│   └── types.ts                    NEW: Transport, TransportResult, TransportError, TransportSubscription
└── index.ts                        No changes (executor is a subpath export)

packages/core/__tests__/
├── executor/
│   ├── executor.test.ts            WorkflowExecutor tests
│   ├── with-store.test.ts          withStore middleware tests
│   ├── with-broadcast.test.ts      withBroadcast + subscriber registry tests
│   ├── plugin.test.ts              defineExecutorPlugin tests
│   ├── outbox.test.ts              Outbox pattern tests with sqliteStore
│   ├── sqlite-store.ts             sqliteStore() test helper using bun:sqlite
│   └── helpers.ts                  Shared test workflow definition + router
├── http/
│   └── http.test.ts                createFetch tests (replaces handler.test.ts)
└── integration/
    └── executor-integration.test.ts End-to-end executor test

packages/core/tsup.config.ts        MODIFY: add executor entry point
```

## Reference

Key files to read before starting:

- **Spec:** `docs/superpowers/specs/2026-03-19-executor-transport-design.md`
- **Compose:** `packages/core/src/compose.ts` — reused for executor pipeline
- **Router:** `packages/core/src/router.ts` — pattern reference for `use()`, hooks, plugins
- **Plugin:** `packages/core/src/plugin.ts` — pattern reference for branded plugins
- **Hooks:** `packages/core/src/hooks.ts` — `HookRegistry` reused for executor hooks
- **Engine types:** `packages/core/src/engine/types.ts` — `StoreAdapter`, `SaveOptions`, `StoredWorkflow`
- **Engine errors:** `packages/core/src/engine/errors.ts` — `ConcurrencyConflictError` kept
- **Memory store:** `packages/core/src/engine/memory-store.ts` — stays as-is
- **HTTP handler:** `packages/core/src/http/handler.ts` — reference for `createFetch` error mapping
- **Existing engine tests:** `packages/core/__tests__/engine/engine.test.ts` — reference for test patterns

## Commands

```bash
# Run executor tests only
pnpm --filter @rytejs/core vitest run __tests__/executor/

# Run all core tests
pnpm --filter @rytejs/core vitest run

# Typecheck
pnpm --filter @rytejs/core tsc --noEmit

# Lint
pnpm biome check packages/core/

# Build
pnpm --filter @rytejs/core run build

# Full check (after all changes)
pnpm run check
```

---

### Task 1: Test helpers — shared workflow definition

**Files:**
- Create: `packages/core/__tests__/executor/helpers.ts`

This task creates the test workflow used across all executor tests. Same pattern as existing test files.

- [ ] **Step 1: Create test helper with workflow definition and router**

```typescript
import { defineWorkflow } from "../../src/definition.js";
import { WorkflowRouter } from "../../src/router.js";
import { z } from "zod";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.date() }),
	},
	commands: {
		Place: z.object({}),
		AddItem: z.object({ item: z.string() }),
	},
	events: {
		OrderPlaced: z.object({ orderId: z.string() }),
	},
	errors: {
		EmptyOrder: z.object({}),
	},
});

function createTestRouter() {
	const router = new WorkflowRouter(definition);

	router.state("Draft", ({ on }) => {
		on("Place", ({ data, transition, emit, error, workflow }) => {
			if (data.items.length === 0) {
				error({ code: "EmptyOrder", data: {} });
			}
			transition("Placed", { items: data.items, placedAt: new Date() });
			emit({ type: "OrderPlaced", data: { orderId: workflow.id } });
		});

		on("AddItem", ({ data, update, command }) => {
			update({ items: [...data.items, command.payload.item] });
		});
	});

	return router;
}

export { definition, createTestRouter };
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/__tests__/executor/helpers.ts
git commit -m "test(executor): add shared test workflow definition and router"
```

---

### Task 2: Executor types

**Files:**
- Create: `packages/core/src/executor/types.ts`

Types only — no implementation. These are the contracts the rest of the code builds against.

- [ ] **Step 1: Create types file**

```typescript
import type { DispatchResult, PipelineError, WorkflowConfig } from "../types.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { StoredWorkflow } from "../engine/types.js";

// ── Context ──

export interface ExecutorContextBase {
	readonly id: string;
	readonly expectedVersion?: number;

	stored: StoredWorkflow | null;
	result: DispatchResult<WorkflowConfig> | null;
	snapshot: WorkflowSnapshot | null;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

export interface ExecuteContext extends ExecutorContextBase {
	readonly operation: "execute";
	readonly command: { type: string; payload: unknown };
}

export interface CreateContext extends ExecutorContextBase {
	readonly operation: "create";
	readonly init: { initialState: string; data: unknown };
}

export type ExecutorContext = ExecuteContext | CreateContext;

// ── Middleware ──

export type ExecutorMiddleware = (
	ctx: ExecutorContext,
	next: () => Promise<void>,
) => Promise<void>;

// ── Result ──

export type ExecutorError =
	| { category: "not_found"; id: string }
	| { category: "conflict"; id: string; expectedVersion: number; actualVersion: number }
	| { category: "already_exists"; id: string }
	| { category: "restore"; id: string; issues: unknown[] }
	| { category: "unexpected"; error: unknown };

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

// ── Broadcast ──

export interface BroadcastMessage {
	snapshot: WorkflowSnapshot;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

export interface SubscriberRegistry {
	subscribe(id: string, callback: (message: BroadcastMessage) => void): () => void;
	notify(id: string, message: BroadcastMessage): void;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: PASS (types only, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/executor/types.ts
git commit -m "feat(executor): add executor context, middleware, and result types"
```

---

### Task 3: Executor plugin

**Files:**
- Create: `packages/core/src/executor/plugin.ts`
- Create: `packages/core/__tests__/executor/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test, vi } from "vitest";
import { defineExecutorPlugin, isExecutorPlugin } from "../../src/executor/plugin.js";

describe("defineExecutorPlugin", () => {
	test("creates a branded plugin function", () => {
		const plugin = defineExecutorPlugin(() => {});
		expect(isExecutorPlugin(plugin)).toBe(true);
		expect(typeof plugin).toBe("function");
	});

	test("non-plugin values return false", () => {
		expect(isExecutorPlugin(() => {})).toBe(false);
		expect(isExecutorPlugin(null)).toBe(false);
		expect(isExecutorPlugin("string")).toBe(false);
	});

	test("plugin receives executor when called", () => {
		const fn = vi.fn();
		const plugin = defineExecutorPlugin(fn);
		const fakeExecutor = {} as never;
		plugin(fakeExecutor);
		expect(fn).toHaveBeenCalledWith(fakeExecutor);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/plugin.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
import type { WorkflowExecutor } from "./executor.js";
import type { WorkflowConfig } from "../types.js";

const EXECUTOR_PLUGIN_SYMBOL: unique symbol = Symbol.for("ryte:executor-plugin");

export type ExecutorPlugin = ((
	// biome-ignore lint/suspicious/noExplicitAny: executor plugin must accept any config
	executor: WorkflowExecutor<any>,
) => void) & { readonly [EXECUTOR_PLUGIN_SYMBOL]: true };

export function defineExecutorPlugin(
	// biome-ignore lint/suspicious/noExplicitAny: executor plugin must accept any config
	fn: (executor: WorkflowExecutor<any>) => void,
): ExecutorPlugin {
	const plugin = fn as ExecutorPlugin;
	Object.defineProperty(plugin, EXECUTOR_PLUGIN_SYMBOL, { value: true, writable: false });
	return plugin;
}

export function isExecutorPlugin(value: unknown): value is ExecutorPlugin {
	return typeof value === "function" && EXECUTOR_PLUGIN_SYMBOL in value;
}
```

Note: `WorkflowExecutor` import will be circular at this point. That's OK — it's a type-only import. Add `import type` to make it explicit. The tests use `as never` for the executor argument so they don't need the real class yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/plugin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor/plugin.ts packages/core/__tests__/executor/plugin.test.ts
git commit -m "feat(executor): add defineExecutorPlugin with branded symbol pattern"
```

---

### Task 4: WorkflowExecutor — core class

**Files:**
- Create: `packages/core/src/executor/executor.ts`
- Create: `packages/core/__tests__/executor/executor.test.ts`

Build the class incrementally. First: create + execute without middleware (bare pipeline with just the core handler).

- [ ] **Step 1: Write failing tests for basic create and execute**

```typescript
import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { createTestRouter, definition } from "./helpers.js";

describe("WorkflowExecutor", () => {
	describe("create", () => {
		test("creates a workflow and returns snapshot + version", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: ["widget"] },
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.snapshot.id).toBe("order-1");
			expect(result.snapshot.state).toBe("Draft");
			expect(result.version).toBe(0); // no store → version stays 0
			expect(result.events).toEqual([]);
		});

		test("returns validation error for invalid initial state", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.create("order-1", {
				initialState: "NonExistent",
				data: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("validation");
		});

		test("returns validation error for invalid data", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: "not-an-array" },
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("validation");
		});
	});

	describe("execute", () => {
		test("dispatches command when stored workflow is on context", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			// Without withStore, we need to manually set ctx.stored.
			// Use middleware to simulate a loaded workflow.
			const workflow = definition.createWorkflow("order-1", {
				initialState: "Draft",
				data: { items: ["widget"] },
			});
			executor.use(async (ctx, next) => {
				if (ctx.operation === "execute") {
					ctx.stored = {
						snapshot: definition.snapshot(workflow),
						version: 1,
					};
				}
				await next();
			});

			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.snapshot.state).toBe("Placed");
			expect(result.events).toHaveLength(1);
			expect(result.events[0].type).toBe("OrderPlaced");
		});

		test("returns error when no stored workflow on context", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);

			// No middleware sets ctx.stored → core handler should handle null
			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("not_found");
		});
	});

	describe("error boundary", () => {
		test("catches unexpected middleware errors", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			executor.use(async () => {
				throw new Error("kaboom");
			});

			const result = await executor.create("order-1", {
				initialState: "Draft",
				data: { items: [] },
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.category).toBe("unexpected");
		});

		test("execute never throws", async () => {
			const router = createTestRouter();
			const executor = new WorkflowExecutor(router);
			executor.use(async () => {
				throw new Error("kaboom");
			});

			// Should not throw — returns result
			const result = await executor.execute("order-1", {
				type: "Place",
				payload: {},
			});
			expect(result.ok).toBe(false);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/executor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write WorkflowExecutor implementation**

```typescript
import { compose } from "../compose.js";
import type { WorkflowConfig } from "../types.js";
import type { WorkflowRouter } from "../router.js";
import { HookRegistry } from "../hooks.js";
import { isExecutorPlugin, type ExecutorPlugin } from "./plugin.js";
import type {
	CreateContext,
	ExecuteContext,
	ExecutionResult,
	ExecutorContext,
	ExecutorMiddleware,
} from "./types.js";

type ExecutorHookEvent = "execute:start" | "execute:end";

export class WorkflowExecutor<TConfig extends WorkflowConfig> {
	private readonly middleware: ExecutorMiddleware[] = [];
	private readonly hookRegistry = new HookRegistry();
	private readonly onHookError: (error: unknown) => void;

	constructor(
		public readonly router: WorkflowRouter<TConfig>,
		options?: { onHookError?: (error: unknown) => void },
	) {
		this.onHookError = options?.onHookError ?? console.error;
	}

	use(arg: ExecutorMiddleware | ExecutorPlugin): this {
		if (isExecutorPlugin(arg)) {
			// biome-ignore lint/suspicious/noExplicitAny: plugin accepts any executor config
			(arg as any)(this);
		} else {
			this.middleware.push(arg);
		}
		return this;
	}

	on(
		event: ExecutorHookEvent,
		callback: (ctx: ExecutorContext) => void | Promise<void>,
	): this {
		// biome-ignore lint/complexity/noBannedTypes: HookRegistry uses Function internally
		this.hookRegistry.add(event, callback as Function);
		return this;
	}

	async create(
		id: string,
		init: { initialState: string; data: unknown },
	): Promise<ExecutionResult> {
		const ctx: CreateContext = {
			operation: "create",
			id,
			init,
			stored: null,
			result: null,
			snapshot: null,
			version: 0,
			events: [],
		};
		return this.run(ctx);
	}

	async execute(
		id: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult> {
		const ctx: ExecuteContext = {
			operation: "execute",
			id,
			command,
			stored: null,
			result: null,
			snapshot: null,
			version: 0,
			events: [],
		};
		return this.run(ctx);
	}

	private async run(ctx: ExecutorContext): Promise<ExecutionResult> {
		await this.hookRegistry.emit("execute:start", this.onHookError, ctx);

		try {
			const chain = [...this.middleware, this.coreHandler()];
			await compose(chain)(ctx);
		} catch (err) {
			ctx.result = {
				ok: false as const,
				error: {
					category: "unexpected" as const,
					error: err,
				},
			};
			ctx.snapshot = null;
		}

		await this.hookRegistry.emit("execute:end", this.onHookError, ctx);

		return this.toResult(ctx);
	}

	private coreHandler(): ExecutorMiddleware {
		const definition = this.router.definition;
		const router = this.router;

		return async (ctx, _next) => {
			if (ctx.operation === "create") {
				try {
					// as never: type erasure — executor holds WorkflowConfig base type,
				// but createWorkflow validates data against Zod schemas at runtime
				const workflow = definition.createWorkflow(ctx.id, {
						initialState: ctx.init.initialState,
						data: ctx.init.data,
					} as never);
					ctx.snapshot = definition.snapshot(workflow);
					ctx.events = [];
				} catch (err) {
					ctx.result = {
						ok: false as const,
						error: {
							category: "validation" as const,
							source: "command" as const,
							issues: [],
							message: err instanceof Error ? err.message : String(err),
						},
					};
				}
				return;
			}

			// execute
			if (!ctx.stored) {
				ctx.result = {
					ok: false as const,
					error: { category: "not_found" as const, id: ctx.id },
				};
				return;
			}

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
			const dispatchResult = await router.dispatch(
				restoreResult.workflow,
				ctx.command as never,
			);

			ctx.result = dispatchResult;

			if (dispatchResult.ok) {
				ctx.snapshot = definition.snapshot(dispatchResult.workflow);
				ctx.events = (dispatchResult.events as Array<{ type: string; data: unknown }>).map(
					(e) => ({ type: e.type, data: e.data }),
				);
			}
		};
	}

	private toResult(ctx: ExecutorContext): ExecutionResult {
		if (ctx.snapshot) {
			return {
				ok: true,
				snapshot: ctx.snapshot,
				version: ctx.version,
				events: ctx.events,
			};
		}

		if (ctx.result && !ctx.result.ok) {
			return { ok: false, error: ctx.result.error };
		}

		// No snapshot and no error result — shouldn't happen, but handle gracefully
		return {
			ok: false,
			error: {
				category: "unexpected",
				error: new Error("Executor pipeline completed without setting snapshot or error"),
			},
		};
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/executor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor/executor.ts packages/core/__tests__/executor/executor.test.ts
git commit -m "feat(executor): add WorkflowExecutor class with create, execute, and error boundary"
```

---

### Task 5: Executor hooks and middleware ordering

**Files:**
- Modify: `packages/core/__tests__/executor/executor.test.ts`

Add tests for hooks and middleware pipeline ordering.

- [ ] **Step 1: Write failing tests for hooks and middleware**

Append to `executor.test.ts`:

```typescript
describe("hooks", () => {
	test("execute:start fires before pipeline", async () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);
		const order: string[] = [];

		executor.on("execute:start", () => { order.push("hook:start"); });
		executor.use(async (ctx, next) => {
			order.push("middleware");
			await next();
		});

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(order).toEqual(["hook:start", "middleware"]);
	});

	test("execute:end fires after pipeline", async () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);
		const order: string[] = [];

		executor.use(async (ctx, next) => {
			order.push("middleware");
			await next();
		});
		executor.on("execute:end", () => { order.push("hook:end"); });

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(order).toEqual(["middleware", "hook:end"]);
	});

	test("execute:end fires even on error", async () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);
		let endFired = false;

		executor.use(async () => { throw new Error("boom"); });
		executor.on("execute:end", () => { endFired = true; });

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(endFired).toBe(true);
	});

	test("execute:end receives final context state", async () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);
		let capturedCtx: ExecutorContext | null = null;

		executor.on("execute:end", (ctx) => { capturedCtx = ctx; });

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		expect(capturedCtx).not.toBeNull();
		expect(capturedCtx!.snapshot).not.toBeNull();
		expect(capturedCtx!.snapshot!.state).toBe("Draft");
	});
});

describe("middleware pipeline", () => {
	test("middleware executes in onion order", async () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);
		const order: string[] = [];

		executor.use(async (ctx, next) => {
			order.push("A:before");
			await next();
			order.push("A:after");
		});
		executor.use(async (ctx, next) => {
			order.push("B:before");
			await next();
			order.push("B:after");
		});

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(order).toEqual(["A:before", "B:before", "B:after", "A:after"]);
	});

	test("middleware can short-circuit by not calling next", async () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);

		executor.use(async (ctx, _next) => {
			// Don't call next — pipeline stops
			ctx.result = { ok: false, error: { category: "not_found", id: ctx.id } } as never;
		});

		const result = await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(result.ok).toBe(false);
	});

	test("use() returns this for chaining", () => {
		const router = createTestRouter();
		const executor = new WorkflowExecutor(router);

		const returned = executor.use(async (_ctx, next) => { await next(); });
		expect(returned).toBe(executor);
	});
});
```

Add this import at the top of the test file:

```typescript
import type { ExecutorContext } from "../../src/executor/types.js";
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/executor.test.ts`
Expected: PASS (the implementation from Task 4 already supports hooks + middleware)

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/executor/executor.test.ts
git commit -m "test(executor): add hook and middleware pipeline ordering tests"
```

---

### Task 6: SaveOptions.events extension

**Files:**
- Modify: `packages/core/src/engine/types.ts`

- [ ] **Step 1: Add optional events field to SaveOptions**

In `packages/core/src/engine/types.ts`, change `SaveOptions`:

```typescript
export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
	events?: Array<{ type: string; data: unknown }>;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/`
Expected: PASS (field is optional, no existing code uses it)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/engine/types.ts
git commit -m "feat(engine): add optional events field to SaveOptions for outbox pattern"
```

---

### Task 7: withStore middleware

**Files:**
- Create: `packages/core/src/executor/with-store.ts`
- Create: `packages/core/__tests__/executor/with-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, vi } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import { ConcurrencyConflictError } from "../../src/engine/errors.js";
import type { StoreAdapter } from "../../src/engine/types.js";
import { createTestRouter, definition } from "./helpers.js";

describe("withStore", () => {
	test("create saves snapshot with version 1", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		const result = await executor.create("order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.version).toBe(1);

		const stored = await store.load("order-1");
		expect(stored).not.toBeNull();
		expect(stored!.version).toBe(1);
		expect(stored!.snapshot.state).toBe("Draft");
	});

	test("execute loads, dispatches, and saves", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["widget"] } });

		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.version).toBe(2);
		expect(result.snapshot.state).toBe("Placed");

		const stored = await store.load("order-1");
		expect(stored!.version).toBe(2);
	});

	test("execute returns not_found for missing workflow", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		const result = await executor.execute("missing", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("not_found");
	});

	test("create returns already_exists for duplicate id", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		const result = await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("already_exists");
	});

	test("concurrent writes return conflict", async () => {
		const store = memoryStore();

		// Two executors sharing the same store — both load version 1
		const exec1 = new WorkflowExecutor(createTestRouter());
		exec1.use(withStore(store));
		const exec2 = new WorkflowExecutor(createTestRouter());
		exec2.use(withStore(store));

		await exec1.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const [r1, r2] = await Promise.all([
			exec1.execute("order-1", { type: "AddItem", payload: { item: "b" } }),
			exec2.execute("order-1", { type: "AddItem", payload: { item: "c" } }),
		]);

		// One succeeds, one conflicts
		const results = [r1, r2];
		const successes = results.filter((r) => r.ok);
		const conflicts = results.filter((r) => !r.ok);
		expect(successes).toHaveLength(1);
		expect(conflicts).toHaveLength(1);
		if (!conflicts[0].ok) {
			expect(conflicts[0].error.category).toBe("conflict");
		}
	});

	test("failed dispatch does not save", async () => {
		const store = memoryStore();
		const saveSpy = vi.spyOn(store, "save");
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		saveSpy.mockClear();

		// Place on empty items → domain error
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		expect(saveSpy).not.toHaveBeenCalled();
	});

	test("events are passed to store.save", async () => {
		const saved: Array<{ events?: Array<{ type: string; data: unknown }> }> = [];
		const store: StoreAdapter = {
			...memoryStore(),
			async save(options) {
				saved.push({ events: options.events });
				const inner = memoryStore();
				// Use a fresh store for the actual save
			},
		};

		// Use a real memoryStore that also tracks events
		const realStore = memoryStore();
		const trackingStore: StoreAdapter = {
			async load(id) { return realStore.load(id); },
			async save(options) {
				saved.push({ events: options.events });
				await realStore.save(options);
			},
		};

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(trackingStore));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		// Create save has no events
		expect(saved[0].events).toEqual([]);
		// Execute save has OrderPlaced event
		expect(saved[1].events).toHaveLength(1);
		expect(saved[1].events![0].type).toBe("OrderPlaced");
	});

	test("expectedVersion mismatch returns conflict without dispatching", async () => {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		// Manually create context with wrong expectedVersion
		// Use a wrapper middleware to set expectedVersion
		const exec2 = new WorkflowExecutor(createTestRouter());
		exec2.use(async (ctx, next) => {
			(ctx as { expectedVersion?: number }).expectedVersion = 99;
			await next();
		});
		exec2.use(withStore(store));

		const result = await exec2.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("conflict");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/with-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write withStore implementation**

```typescript
import { ConcurrencyConflictError } from "../engine/errors.js";
import type { StoreAdapter } from "../engine/types.js";
import type { ExecutorMiddleware } from "./types.js";

export function withStore(store: StoreAdapter): ExecutorMiddleware {
	return async (ctx, next) => {
		if (ctx.operation === "execute") {
			const stored = await store.load(ctx.id);
			if (!stored) {
				ctx.result = {
					ok: false as const,
					error: { category: "not_found" as const, id: ctx.id },
				};
				return;
			}
			ctx.stored = stored;

			if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== stored.version) {
				ctx.result = {
					ok: false as const,
					error: {
						category: "conflict" as const,
						id: ctx.id,
						expectedVersion: ctx.expectedVersion,
						actualVersion: stored.version,
					},
				};
				return;
			}
		} else {
			const existing = await store.load(ctx.id);
			if (existing) {
				ctx.result = {
					ok: false as const,
					error: { category: "already_exists" as const, id: ctx.id },
				};
				return;
			}
		}

		await next();

		if (ctx.snapshot) {
			try {
				await store.save({
					id: ctx.id,
					snapshot: ctx.snapshot,
					expectedVersion: ctx.stored?.version ?? 0,
					events: ctx.events,
				});
				ctx.version = (ctx.stored?.version ?? 0) + 1;
			} catch (err) {
				if (err instanceof ConcurrencyConflictError) {
					ctx.result = {
						ok: false as const,
						error: {
							category: "conflict" as const,
							id: ctx.id,
							expectedVersion: ctx.stored?.version ?? 0,
							actualVersion: -1,
						},
					};
					ctx.snapshot = null;
					return;
				}
				throw err;
			}
		}
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/with-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor/with-store.ts packages/core/__tests__/executor/with-store.test.ts
git commit -m "feat(executor): add withStore middleware — persistence with version check and outbox"
```

---

### Task 8: withBroadcast middleware + SubscriberRegistry

**Files:**
- Create: `packages/core/src/executor/with-broadcast.ts`
- Create: `packages/core/__tests__/executor/with-broadcast.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, vi } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { withBroadcast, createSubscriberRegistry } from "../../src/executor/with-broadcast.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import type { BroadcastMessage } from "../../src/executor/types.js";
import { createTestRouter } from "./helpers.js";

describe("createSubscriberRegistry", () => {
	test("subscribe and notify", () => {
		const registry = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];

		registry.subscribe("wf-1", (msg) => messages.push(msg));
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(messages).toHaveLength(1);
		expect(messages[0].version).toBe(1);
	});

	test("unsubscribe stops notifications", () => {
		const registry = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];

		const unsub = registry.subscribe("wf-1", (msg) => messages.push(msg));
		unsub();
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(messages).toHaveLength(0);
	});

	test("multiple subscribers per id", () => {
		const registry = createSubscriberRegistry();
		const a: BroadcastMessage[] = [];
		const b: BroadcastMessage[] = [];

		registry.subscribe("wf-1", (msg) => a.push(msg));
		registry.subscribe("wf-1", (msg) => b.push(msg));
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});

	test("notify only targets matching id", () => {
		const registry = createSubscriberRegistry();
		const a: BroadcastMessage[] = [];
		const b: BroadcastMessage[] = [];

		registry.subscribe("wf-1", (msg) => a.push(msg));
		registry.subscribe("wf-2", (msg) => b.push(msg));
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(0);
	});
});

describe("withBroadcast", () => {
	test("notifies subscribers after successful execution", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => messages.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));
		executor.use(withBroadcast(subscribers));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		expect(messages).toHaveLength(1);
		expect(messages[0].version).toBe(1);
		expect(messages[0].snapshot.state).toBe("Draft");
	});

	test("does not notify on failed dispatch", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => messages.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));
		executor.use(withBroadcast(subscribers));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		messages.length = 0; // clear create notification

		// Place on empty items → domain error
		await executor.execute("order-1", { type: "Place", payload: {} });

		expect(messages).toHaveLength(0);
	});

	test("broadcast includes events", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => messages.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));
		executor.use(withBroadcast(subscribers));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		const placeMsg = messages[1];
		expect(placeMsg.events).toHaveLength(1);
		expect(placeMsg.events[0].type).toBe("OrderPlaced");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/with-broadcast.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
import type { BroadcastMessage, ExecutorMiddleware, SubscriberRegistry } from "./types.js";

export function createSubscriberRegistry(): SubscriberRegistry {
	const subscribers = new Map<string, Set<(message: BroadcastMessage) => void>>();

	return {
		subscribe(id, callback) {
			let set = subscribers.get(id);
			if (!set) {
				set = new Set();
				subscribers.set(id, set);
			}
			set.add(callback);
			return () => {
				set!.delete(callback);
				if (set!.size === 0) {
					subscribers.delete(id);
				}
			};
		},

		notify(id, message) {
			const set = subscribers.get(id);
			if (!set) return;
			for (const callback of set) {
				callback(message);
			}
		},
	};
}

export function withBroadcast(subscribers: SubscriberRegistry): ExecutorMiddleware {
	return async (ctx, next) => {
		await next();

		if (ctx.snapshot) {
			subscribers.notify(ctx.id, {
				snapshot: ctx.snapshot,
				version: ctx.version,
				events: ctx.events,
			});
		}
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/with-broadcast.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor/with-broadcast.ts packages/core/__tests__/executor/with-broadcast.test.ts
git commit -m "feat(executor): add withBroadcast middleware and createSubscriberRegistry"
```

---

### Task 9: SQLite store + outbox pattern tests

**Files:**
- Create: `packages/core/__tests__/executor/sqlite-store.ts`
- Create: `packages/core/__tests__/executor/outbox.test.ts`

This proves the outbox pattern works with real SQL transactions using `bun:sqlite` in-memory.

- [ ] **Step 0: Install better-sqlite3 as dev dependency**

```bash
pnpm --filter @rytejs/core add -D better-sqlite3 @types/better-sqlite3
```

- [ ] **Step 1: Create sqliteStore helper**

```typescript
import Database from "better-sqlite3";
import { ConcurrencyConflictError } from "../../src/engine/errors.js";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "../../src/engine/types.js";

export interface SqliteStoreResult {
	store: StoreAdapter;
	getOutbox(): Array<{ workflowId: string; eventType: string; eventData: string }>;
	clearOutbox(): void;
	db: Database;
}

export function sqliteStore(): SqliteStoreResult {
	const db = new Database(":memory:");

	db.exec(`
		CREATE TABLE workflows (
			id TEXT PRIMARY KEY,
			snapshot TEXT NOT NULL,
			version INTEGER NOT NULL
		)
	`);

	db.exec(`
		CREATE TABLE outbox (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			workflow_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			event_data TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const store: StoreAdapter = {
		async load(id: string): Promise<StoredWorkflow | null> {
			const row = db.prepare("SELECT snapshot, version FROM workflows WHERE id = ?").get(id) as
				| { snapshot: string; version: number }
				| undefined;
			if (!row) return null;
			return { snapshot: JSON.parse(row.snapshot), version: row.version };
		},

		async save(options: SaveOptions): Promise<void> {
			const { id, snapshot, expectedVersion, events } = options;

			const txn = db.transaction(() => {
				const existing = db.prepare("SELECT version FROM workflows WHERE id = ?").get(id) as
					| { version: number }
					| undefined;
				const currentVersion = existing?.version ?? 0;

				if (currentVersion !== expectedVersion) {
					throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
				}

				if (existing) {
					db.prepare(
						"UPDATE workflows SET snapshot = ?, version = ? WHERE id = ?",
					).run(JSON.stringify(snapshot), currentVersion + 1, id);
				} else {
					db.prepare(
						"INSERT INTO workflows (id, snapshot, version) VALUES (?, ?, 1)",
					).run(id, JSON.stringify(snapshot));
				}

				if (events && events.length > 0) {
					const insert = db.prepare(
						"INSERT INTO outbox (workflow_id, event_type, event_data) VALUES (?, ?, ?)",
					);
					for (const event of events) {
						insert.run(id, event.type, JSON.stringify(event.data));
					}
				}
			});

			txn();
		},
	};

	return {
		store,
		getOutbox() {
			return db.prepare(
				"SELECT workflow_id as workflowId, event_type as eventType, event_data as eventData FROM outbox ORDER BY id",
			).all() as Array<{ workflowId: string; eventType: string; eventData: string }>;
		},
		clearOutbox() {
			db.exec("DELETE FROM outbox");
		},
		db,
	};
}
```

- [ ] **Step 2: Write outbox tests**

```typescript
import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { createTestRouter } from "./helpers.js";
import { sqliteStore } from "./sqlite-store.js";

describe("outbox pattern with SQLite", () => {
	test("snapshot and events are saved in one transaction", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["widget"] } });
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(true);

		// Verify snapshot was saved
		const stored = await store.load("order-1");
		expect(stored!.snapshot.state).toBe("Placed");
		expect(stored!.version).toBe(2);

		// Verify events in outbox
		const outbox = getOutbox();
		expect(outbox).toHaveLength(1);
		expect(outbox[0].workflowId).toBe("order-1");
		expect(outbox[0].eventType).toBe("OrderPlaced");
		expect(JSON.parse(outbox[0].eventData)).toEqual({ orderId: "order-1" });
	});

	test("failed dispatch writes nothing to outbox", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		expect(getOutbox()).toHaveLength(0);
	});

	test("create saves snapshot but no events in outbox", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		const stored = await store.load("order-1");
		expect(stored!.version).toBe(1);
		expect(getOutbox()).toHaveLength(0);
	});

	test("version conflict rolls back both snapshot and events", async () => {
		const { store, getOutbox, db } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		// Manually bump version to simulate concurrent write
		db.exec("UPDATE workflows SET version = 99 WHERE id = 'order-1'");

		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("conflict");
		}

		// No events should have been written
		expect(getOutbox()).toHaveLength(0);

		// Snapshot should be unchanged (version 99, not updated)
		const stored = await store.load("order-1");
		expect(stored!.version).toBe(99);
	});

	test("multiple events are all persisted", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		// Place emits one event. Let's verify with a workflow that emits multiple.
		// For now, verify single event works.
		const outbox = getOutbox();
		expect(outbox).toHaveLength(1);
	});

	test("outbox survives after clearing and re-executing", async () => {
		const { store, getOutbox, clearOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		expect(getOutbox()).toHaveLength(1);
		clearOutbox();
		expect(getOutbox()).toHaveLength(0);

		// Create another workflow and execute
		await executor.create("order-2", { initialState: "Draft", data: { items: ["b"] } });
		await executor.execute("order-2", { type: "Place", payload: {} });

		expect(getOutbox()).toHaveLength(1);
		expect(getOutbox()[0].workflowId).toBe("order-2");
	});
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/executor/outbox.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/__tests__/executor/sqlite-store.ts packages/core/__tests__/executor/outbox.test.ts
git commit -m "test(executor): add outbox pattern tests with transactional SQLite store"
```

---

### Task 10: Transport types

**Files:**
- Create: `packages/core/src/transport/types.ts`

Types only — implementations come in a follow-up plan.

- [ ] **Step 1: Create transport types**

```typescript
import type { PipelineError, WorkflowConfig } from "../types.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { BroadcastMessage } from "../executor/types.js";

export type { BroadcastMessage };

export interface Transport {
	dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult>;

	subscribe(
		id: string,
		callback: (message: BroadcastMessage) => void,
	): TransportSubscription;
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
			error: TransportError | PipelineError<WorkflowConfig>;
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

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/transport/types.ts
git commit -m "feat(transport): add Transport interface and related types"
```

---

### Task 11: createFetch — HTTP handler replacement

**Files:**
- Create: `packages/core/src/http/http.ts`
- Create: `packages/core/__tests__/http/http.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import { createFetch } from "../../src/http/http.js";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import { createTestRouter } from "../executor/helpers.js";

function makeRequest(method: string, path: string, body?: unknown): Request {
	const url = `http://localhost${path}`;
	const init: RequestInit = { method };
	if (body) {
		init.body = JSON.stringify(body);
		init.headers = { "Content-Type": "application/json" };
	}
	return new Request(url, init);
}

describe("createFetch", () => {
	function setup() {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));
		const handler = createFetch({ order: executor }, store);
		return { handler, store, executor };
	}

	test("PUT creates a workflow (201)", async () => {
		const { handler } = setup();
		const req = makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		});
		const res = await handler(req);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.snapshot.state).toBe("Draft");
		expect(body.version).toBe(1);
	});

	test("GET loads a workflow (200)", async () => {
		const { handler } = setup();

		await handler(makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		}));

		const res = await handler(makeRequest("GET", "/order/order-1"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.snapshot.state).toBe("Draft");
		expect(body.version).toBe(1);
	});

	test("GET returns 404 for missing workflow", async () => {
		const { handler } = setup();
		const res = await handler(makeRequest("GET", "/order/missing"));
		expect(res.status).toBe(404);
	});

	test("POST executes a command (200)", async () => {
		const { handler } = setup();

		await handler(makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		}));

		const res = await handler(makeRequest("POST", "/order/order-1", {
			type: "Place",
			payload: {},
		}));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.snapshot.state).toBe("Placed");
		expect(body.version).toBe(2);
		expect(body.events).toHaveLength(1);
	});

	test("POST returns 422 for domain error", async () => {
		const { handler } = setup();

		await handler(makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: [] },
		}));

		const res = await handler(makeRequest("POST", "/order/order-1", {
			type: "Place",
			payload: {},
		}));

		expect(res.status).toBe(422);
	});

	test("PUT returns 409 for duplicate", async () => {
		const { handler } = setup();

		await handler(makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: [] },
		}));

		const res = await handler(makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: [] },
		}));

		expect(res.status).toBe(409);
	});

	test("unknown executor returns 404", async () => {
		const { handler } = setup();
		const res = await handler(makeRequest("POST", "/unknown/id-1", {
			type: "Foo",
			payload: {},
		}));
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/http/http.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write createFetch implementation**

```typescript
import type { StoreAdapter } from "../engine/types.js";
import type { WorkflowExecutor } from "../executor/executor.js";
import type { ExecutionResult } from "../executor/types.js";
import type { WorkflowConfig } from "../types.js";

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

		const [name, id] = parts;
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
			const body = await request.json() as { initialState: string; data: unknown };
			const result = await executor.create(id, body);
			return resultToResponse(result, 201);
		}

		if (method === "POST") {
			const body = await request.json() as { type: string; payload: unknown };
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
		case "restore":
		case "unexpected":
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/http/http.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/http.ts packages/core/__tests__/http/http.test.ts
git commit -m "feat(http): add createFetch — fetch handler replacement for createHandler"
```

---

### Task 12: Executor entry point + exports

**Files:**
- Create: `packages/core/src/executor/index.ts`
- Modify: `packages/core/tsup.config.ts`

- [ ] **Step 1: Create executor index.ts**

```typescript
export { WorkflowExecutor } from "./executor.js";
export { defineExecutorPlugin, isExecutorPlugin } from "./plugin.js";
export type { ExecutorPlugin } from "./plugin.js";
export { withStore } from "./with-store.js";
export { withBroadcast, createSubscriberRegistry } from "./with-broadcast.js";
export type {
	BroadcastMessage,
	CreateContext,
	ExecuteContext,
	ExecutionResult,
	ExecutorContext,
	ExecutorContextBase,
	ExecutorError,
	ExecutorMiddleware,
	SubscriberRegistry,
} from "./types.js";
```

- [ ] **Step 2: Add executor entry point to tsup.config.ts**

Read `packages/core/tsup.config.ts` first, then add the executor entry. The current entries are: `src/index.ts`, `src/engine/index.ts`, `src/reactor/index.ts`, `src/http/index.ts`. Add `src/executor/index.ts`.

- [ ] **Step 3: Create transport index.ts**

```typescript
export type {
	BroadcastMessage,
	Transport,
	TransportError,
	TransportResult,
	TransportSubscription,
} from "./types.js";
```

- [ ] **Step 4: Add transport entry point to tsup.config.ts**

Add `src/transport/index.ts` to the entry array.

- [ ] **Step 5: Update http/index.ts**

Replace the existing exports with:

```typescript
export { createFetch } from "./http.js";
```

- [ ] **Step 6: Add subpath exports to package.json**

Add `./executor` and `./transport` entries to `packages/core/package.json` matching the existing pattern for `./engine`, `./reactor`, `./http`. Read the file first to see the exact format.

- [ ] **Step 7: Build and verify**

Run: `pnpm --filter @rytejs/core run build`
Expected: PASS — all entry points build

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/executor/index.ts packages/core/src/transport/index.ts packages/core/src/http/index.ts packages/core/tsup.config.ts packages/core/package.json
git commit -m "feat(core): add executor and transport entry points, update http exports"
```

---

### Task 13: Integration test

**Files:**
- Create: `packages/core/__tests__/integration/executor-integration.test.ts`

End-to-end test: create → execute → broadcast → concurrent write → conflict.

- [ ] **Step 1: Write integration test**

```typescript
import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { withBroadcast, createSubscriberRegistry } from "../../src/executor/with-broadcast.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import type { BroadcastMessage } from "../../src/executor/types.js";
import { createTestRouter } from "../executor/helpers.js";

describe("executor integration", () => {
	test("full lifecycle: create → execute → broadcast → version increment", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const broadcasts: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => broadcasts.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));
		executor.use(withBroadcast(subscribers));

		// Create
		const created = await executor.create("order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.version).toBe(1);
		expect(broadcasts).toHaveLength(1);

		// Execute
		const placed = await executor.execute("order-1", { type: "Place", payload: {} });
		expect(placed.ok).toBe(true);
		if (!placed.ok) return;
		expect(placed.version).toBe(2);
		expect(placed.snapshot.state).toBe("Placed");
		expect(placed.events[0].type).toBe("OrderPlaced");
		expect(broadcasts).toHaveLength(2);
		expect(broadcasts[1].version).toBe(2);
		expect(broadcasts[1].events[0].type).toBe("OrderPlaced");
	});

	test("concurrent writes: one succeeds, one gets conflict", async () => {
		const store = memoryStore();
		const exec1 = new WorkflowExecutor(createTestRouter());
		exec1.use(withStore(store));
		const exec2 = new WorkflowExecutor(createTestRouter());
		exec2.use(withStore(store));

		await exec1.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const [r1, r2] = await Promise.all([
			exec1.execute("order-1", { type: "AddItem", payload: { item: "b" } }),
			exec2.execute("order-1", { type: "AddItem", payload: { item: "c" } }),
		]);

		const successes = [r1, r2].filter((r) => r.ok);
		const conflicts = [r1, r2].filter((r) => !r.ok);
		expect(successes).toHaveLength(1);
		expect(conflicts).toHaveLength(1);
	});

	test("hooks fire in correct order", async () => {
		const store = memoryStore();
		const order: string[] = [];

		const executor = new WorkflowExecutor(createTestRouter());
		executor.on("execute:start", () => order.push("start"));
		executor.use(withStore(store));
		executor.on("execute:end", () => order.push("end"));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(order).toEqual(["start", "end"]);
	});
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @rytejs/core vitest run __tests__/integration/executor-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/integration/executor-integration.test.ts
git commit -m "test(executor): add end-to-end integration test"
```

---

### Task 14: Remove old engine code

**Files:**
- Delete: `packages/core/src/engine/engine.ts`
- Delete: `packages/core/src/engine/memory-adapter.ts`
- Delete: `packages/core/src/engine/memory-lock.ts`
- Delete: `packages/core/src/engine/memory-queue.ts`
- Delete: `packages/core/src/http/handler.ts`
- Modify: `packages/core/src/engine/types.ts` — remove `LockAdapter`, `QueueAdapter`, `TransactionalAdapter`, `EnqueueMessage`, `QueueMessage`, `EngineOptions`, old `ExecutionResult`
- Modify: `packages/core/src/engine/errors.ts` — remove `LockConflictError`, `WorkflowNotFoundError`, `WorkflowAlreadyExistsError`, `RouterNotFoundError`, `RestoreError` (keep `ConcurrencyConflictError`)
- Modify: `packages/core/src/engine/index.ts` — update exports
- Delete: `packages/core/__tests__/engine/engine.test.ts`
- Delete: `packages/core/__tests__/engine/memory-adapter.test.ts`
- Delete: `packages/core/__tests__/engine/memory-lock.test.ts`
- Delete: `packages/core/__tests__/engine/memory-queue.test.ts`
- Delete: `packages/core/__tests__/engine/errors.test.ts`
- Delete: `packages/core/__tests__/http/handler.test.ts`

- [ ] **Step 1: Delete files**

```bash
rm packages/core/src/engine/engine.ts
rm packages/core/src/engine/memory-adapter.ts
rm packages/core/src/engine/memory-lock.ts
rm packages/core/src/engine/memory-queue.ts
rm packages/core/src/http/handler.ts
rm packages/core/__tests__/engine/engine.test.ts
rm packages/core/__tests__/engine/memory-adapter.test.ts
rm packages/core/__tests__/engine/memory-lock.test.ts
rm packages/core/__tests__/engine/memory-queue.test.ts
rm packages/core/__tests__/engine/errors.test.ts
rm packages/core/__tests__/http/handler.test.ts
```

- [ ] **Step 2: Slim down engine/types.ts**

Keep only: `StoredWorkflow`, `SaveOptions` (with events), `StoreAdapter`, `EmittedEvent`. Remove everything else.

```typescript
import type { WorkflowSnapshot } from "../snapshot.js";

export interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
	events?: Array<{ type: string; data: unknown }>;
}

export interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}

export interface EmittedEvent {
	type: string;
	data: unknown;
}
```

- [ ] **Step 3: Slim down engine/errors.ts**

Keep only `ConcurrencyConflictError`:

```typescript
export class ConcurrencyConflictError extends Error {
	readonly name = "ConcurrencyConflictError";

	constructor(
		readonly workflowId: string,
		readonly expectedVersion: number,
		readonly actualVersion: number,
	) {
		super(
			`Concurrency conflict for workflow "${workflowId}": expected version ${expectedVersion}, actual ${actualVersion}`,
		);
	}
}
```

- [ ] **Step 4: Update engine/index.ts**

```typescript
export { ConcurrencyConflictError } from "./errors.js";
export { memoryStore } from "./memory-store.js";
export type {
	EmittedEvent,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
} from "./types.js";
```

- [ ] **Step 5: Delete http/types.ts**

`packages/core/src/http/types.ts` only contains `HttpHandlerOptions` which is no longer needed. Delete it.

```bash
rm packages/core/src/http/types.ts
```

- [ ] **Step 6: Run all core tests**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: PASS — old tests deleted, new tests pass, remaining tests (router, definition, etc.) unaffected

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Lint**

Run: `pnpm biome check packages/core/`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 9: Commit**

```bash
git add -A packages/core/
git commit -m "refactor(core): remove old ExecutionEngine, LockAdapter, QueueAdapter, createHandler"
```

---

### Task 15: Build and full check

**Files:**
- None — verification only

- [ ] **Step 1: Build core**

Run: `pnpm --filter @rytejs/core run build`
Expected: PASS — all entry points (index, engine, executor, reactor, http, transport) build successfully

- [ ] **Step 2: Build and test testing package**

Run: `pnpm --filter @rytejs/testing vitest run`
Expected: PASS — testing package imports from core dist

- [ ] **Step 3: Typecheck docs snippets**

Run: `pnpm --filter @rytejs/docs run typecheck`
Expected: PASS (or identify doc snippets that import from engine and need updating)

- [ ] **Step 4: Full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 5: Commit any fixes**

If doc snippets or other files needed updating:

```bash
git add -A
git commit -m "fix: update imports after engine → executor migration"
```

- [ ] **Step 6: Push**

```bash
git push
```
