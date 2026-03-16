# @rytejs/otel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenTelemetry instrumentation to @rytejs via a new `@rytejs/otel` package, including a prerequisite breaking change to core's hook system.

**Architecture:** The core hook system is extended with `dispatch:start`/`dispatch:end` (whole-call scope) alongside renamed `pipeline:start`/`pipeline:end` (handler-pipeline scope). A new `packages/otel` package exports a single `createOtelPlugin()` that registers hooks for tracing (spans), metrics (counters/histograms), and structured logging via the `@opentelemetry/api` layer.

**Tech Stack:** TypeScript, Vitest, tsup, `@opentelemetry/api`, `@opentelemetry/api-logs`, Zod v4

**Spec:** `docs/superpowers/specs/2026-03-15-otel-library-design.md`

---

## File Map

### Core changes (packages/core)

| File | Action | Responsibility |
|---|---|---|
| `src/hooks.ts` | Modify | Add `pipeline:start`, `pipeline:end` to `HookEvent` type and `HOOK_EVENTS` set |
| `src/router.ts` | Modify | Rename emit calls, add new overloads, wrap dispatch in try/finally |
| `__tests__/hooks.test.ts` | Modify | Rename old hook refs, add new hook tests |
| `__tests__/router.test.ts` | Modify | Rename `dispatch:start`/`dispatch:end` → `pipeline:start`/`pipeline:end` |
| `__tests__/plugin.test.ts` | Modify | Rename hook refs |

### Documentation changes (docs)

| File | Action | Responsibility |
|---|---|---|
| `docs/guide/hooks-and-plugins.md` | Modify | Update hook table, examples, and guarantees for 7-hook system |
| `docs/guide/observability.md` | Modify | Rename `dispatch:start`/`dispatch:end` → `pipeline:start`/`pipeline:end` in all examples |
| `docs/guide/error-handling.md` | Modify | Update one `dispatch:end` reference (line 95) |
| `docs/api/core/src.md` | Modify | Update `HookEvent` type and `on()` overload signatures for 7-hook system |

### New package (packages/otel)

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Create | Package metadata, peer deps, scripts |
| `tsconfig.json` | Create | Extends base tsconfig |
| `tsup.config.ts` | Create | Build config (CJS + ESM + dts) |
| `src/index.ts` | Create | Public export: `createOtelPlugin` |
| `src/conventions.ts` | Create | All attribute names, span names, metric names as constants |
| `src/tracing.ts` | Create | Span lifecycle: create, events, attributes, end |
| `src/metrics.ts` | Create | Counter and histogram instrument logic |
| `src/logging.ts` | Create | Structured OTEL log emission |
| `src/plugin.ts` | Create | `createOtelPlugin()` — composes tracing/metrics/logging into hooks |
| `src/__tests__/tracing.test.ts` | Create | Span creation, attributes, events, error status |
| `src/__tests__/metrics.test.ts` | Create | Counter/histogram assertions |
| `src/__tests__/logging.test.ts` | Create | Log severity, body, attributes |
| `src/__tests__/plugin.test.ts` | Create | Integration: zero-config, overrides, no-op, multi-dispatch |

---

## Chunk 1: Core Hook Rename

### Task 1: Update hook type definitions

**Files:**
- Modify: `packages/core/src/hooks.ts`

- [ ] **Step 1: Update HookEvent type and HOOK_EVENTS set**

Replace the entire file content:

```ts
/** The lifecycle hook event names. */
export type HookEvent =
	| "dispatch:start"
	| "dispatch:end"
	| "pipeline:start"
	| "pipeline:end"
	| "transition"
	| "error"
	| "event";

export const HOOK_EVENTS: ReadonlySet<string> = new Set<HookEvent>([
	"dispatch:start",
	"dispatch:end",
	"pipeline:start",
	"pipeline:end",
	"transition",
	"error",
	"event",
]);

/**
 * Internal registry for lifecycle hook callbacks.
 * Hooks are observers — errors are caught and forwarded, never affecting dispatch.
 */
export class HookRegistry {
	// biome-ignore lint/complexity/noBannedTypes: callbacks have varying signatures per hook event
	private hooks = new Map<string, Function[]>();

	/** Register a callback for a hook event. */
	// biome-ignore lint/complexity/noBannedTypes: callbacks have varying signatures per hook event
	add(event: string, callback: Function): void {
		const existing = this.hooks.get(event) ?? [];
		existing.push(callback);
		this.hooks.set(event, existing);
	}

	/** Emit a hook event, calling all registered callbacks. Errors are caught and forwarded. */
	async emit(event: string, onError: (err: unknown) => void, ...args: unknown[]): Promise<void> {
		const callbacks = this.hooks.get(event);
		if (!callbacks) return;
		for (const cb of callbacks) {
			try {
				await cb(...args);
			} catch (err) {
				onError(err);
			}
		}
	}

	/** Merge another registry's hooks into this one (used by composable routers). */
	merge(other: HookRegistry): void {
		for (const [event, callbacks] of other.hooks) {
			const existing = this.hooks.get(event) ?? [];
			existing.push(...callbacks);
			this.hooks.set(event, existing);
		}
	}
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: PASS (no consumers of the new events exist yet, and old events still exist in the type)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/hooks.ts
git commit -m "feat: add pipeline:start and pipeline:end to HookEvent type"
```

---

### Task 2: Update router overloads and dispatch flow

**Files:**
- Modify: `packages/core/src/router.ts`

This is the most complex change. The router needs:
1. New `dispatch:start` / `dispatch:end` overloads (raw workflow + command, no context)
2. Existing `dispatch:start` / `dispatch:end` overloads renamed to `pipeline:start` / `pipeline:end`
3. The `dispatch()` method refactored with try/finally for the guarantee

- [ ] **Step 1: Update the `on()` overloads (lines 202-234)**

Replace the hook overloads section. Keep the wildcard handler overload and implementation signature unchanged.

```ts
	/**
	 * Registers a lifecycle hook callback.
	 * @param event - The lifecycle event name
	 * @param callback - The callback to invoke when the event fires
	 */
	on(
		event: "dispatch:start",
		callback: (
			workflow: Workflow<TConfig>,
			command: { type: CommandNames<TConfig>; payload: unknown },
		) => void | Promise<void>,
	): this;
	on(
		event: "dispatch:end",
		callback: (
			workflow: Workflow<TConfig>,
			command: { type: CommandNames<TConfig>; payload: unknown },
			result: DispatchResult<TConfig>,
		) => void | Promise<void>,
	): this;
	on(
		event: "pipeline:start",
		callback: (ctx: ReadonlyContext<TConfig, TDeps>) => void | Promise<void>,
	): this;
	on(
		event: "pipeline:end",
		callback: (
			ctx: ReadonlyContext<TConfig, TDeps>,
			result: DispatchResult<TConfig>,
		) => void | Promise<void>,
	): this;
	on(
		event: "transition",
		callback: (
			from: StateNames<TConfig>,
			to: StateNames<TConfig>,
			workflow: Workflow<TConfig>,
		) => void | Promise<void>,
	): this;
	on(
		event: "error",
		callback: (
			error: PipelineError<TConfig>,
			ctx: ReadonlyContext<TConfig, TDeps>,
		) => void | Promise<void>,
	): this;
	on(
		event: "event",
		callback: (
			event: { type: EventNames<TConfig>; data: unknown },
			workflow: Workflow<TConfig>,
		) => void | Promise<void>,
	): this;
```

- [ ] **Step 2: Refactor the `dispatch()` method**

Replace the entire `dispatch()` method body. Key changes:
- Emit `dispatch:start` at the very top
- Wrap everything after in try/finally
- Rename inner `dispatch:start` → `pipeline:start`, `dispatch:end` → `pipeline:end`
- Emit `dispatch:end` in the finally block
- Use a `result` variable declared outside the try to make it accessible in finally

```ts
	async dispatch(
		workflow: Workflow<TConfig>,
		command: { type: CommandNames<TConfig>; payload: unknown },
	): Promise<DispatchResult<TConfig>> {
		// Hook: dispatch:start (fires before any validation)
		await this.hookRegistry.emit("dispatch:start", this.onHookError, workflow, command);

		let result: DispatchResult<TConfig>;
		try {
			result = await this.executePipeline(workflow, command);
		} catch (err) {
			// Catch unexpected throws from executePipeline internals (e.g. getCommandSchema)
			result = {
				ok: false as const,
				error: {
					category: "unexpected" as const,
					error: err,
					message: err instanceof Error ? err.message : String(err),
				},
			};
		} finally {
			// Hook: dispatch:end (guaranteed to fire if dispatch:start fired)
			// biome-ignore lint/correctness/noUnsafeFinally: result is always assigned — either by try or catch
			await this.hookRegistry.emit("dispatch:end", this.onHookError, workflow, command, result!);
		}
		return result;
	}

	private async executePipeline(
		workflow: Workflow<TConfig>,
		command: { type: CommandNames<TConfig>; payload: unknown },
	): Promise<DispatchResult<TConfig>> {
		if (!this.definition.hasState(workflow.state)) {
			return {
				ok: false,
				error: {
					category: "router",
					code: "UNKNOWN_STATE",
					message: `Unknown state: ${workflow.state}`,
				},
			};
		}

		const commandSchema = this.definition.getCommandSchema(command.type);
		const payloadResult = commandSchema.safeParse(command.payload);
		if (!payloadResult.success) {
			return {
				ok: false,
				error: {
					category: "validation",
					source: "command",
					issues: payloadResult.error.issues,
					message: `Invalid command payload: ${payloadResult.error.issues.map((i) => i.message).join(", ")}`,
				},
			};
		}
		const validatedCommand = { type: command.type, payload: payloadResult.data };

		const stateName = workflow.state;
		const singleRouter = this.singleStateBuilders.get(stateName);
		const multiRouter = this.multiStateBuilders.get(stateName);
		const singleHandler = singleRouter?.handlers.get(command.type);
		const multiHandler = multiRouter?.handlers.get(command.type);
		const wildcardHandler = this.wildcardHandlers.get(command.type);

		let routeEntry: HandlerEntry | undefined;
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — matched router's state type is dynamic
		let matchedRouter: StateBuilder<TConfig, TDeps, any> | undefined;

		if (singleHandler) {
			routeEntry = singleHandler;
			matchedRouter = singleRouter;
		} else if (multiHandler) {
			routeEntry = multiHandler;
			matchedRouter = multiRouter;
		} else if (wildcardHandler) {
			routeEntry = wildcardHandler;
			matchedRouter = undefined;
		}

		if (!routeEntry) {
			return {
				ok: false,
				error: {
					category: "router",
					code: "NO_HANDLER",
					message: `No handler for command '${command.type}' in state '${stateName}'`,
				},
			};
		}

		const stateMiddleware: AnyMiddleware[] = [];
		if (matchedRouter) {
			if (singleRouter) stateMiddleware.push(...singleRouter.middleware);
			if (multiRouter && multiRouter !== singleRouter)
				stateMiddleware.push(...multiRouter.middleware);
		}

		const chain: AnyMiddleware[] = [
			...this.globalMiddleware,
			...stateMiddleware,
			...routeEntry.inlineMiddleware,
			routeEntry.handler,
		];

		const ctx = createContext<TConfig, TDeps>(
			this.definition,
			workflow,
			validatedCommand,
			this.deps,
			{ wrapDeps: this.wrapDeps },
		);

		// Hook: pipeline:start
		await this.hookRegistry.emit("pipeline:start", this.onHookError, ctx);

		try {
			const composed = compose(chain);
			await composed(ctx);
			const result: DispatchResult<TConfig> = {
				ok: true as const,
				workflow: ctx.getWorkflowSnapshot(),
				events: [...ctx.events],
			};

			// Hook: transition (if state changed)
			if (result.ok && result.workflow.state !== workflow.state) {
				await this.hookRegistry.emit(
					"transition",
					this.onHookError,
					workflow.state,
					result.workflow.state,
					result.workflow,
				);
			}

			// Hook: event (for each emitted event)
			if (result.ok) {
				for (const event of result.events) {
					await this.hookRegistry.emit("event", this.onHookError, event, result.workflow);
				}
			}

			// Hook: pipeline:end
			await this.hookRegistry.emit("pipeline:end", this.onHookError, ctx, result);

			return result;
		} catch (err) {
			let result: DispatchResult<TConfig>;
			if (err instanceof DomainErrorSignal) {
				result = {
					ok: false as const,
					error: {
						category: "domain" as const,
						code: err.code as ErrorCodes<TConfig>,
						data: err.data as ErrorData<TConfig, ErrorCodes<TConfig>>,
					},
				};
			} else if (err instanceof ValidationError) {
				result = {
					ok: false as const,
					error: {
						category: "validation" as const,
						source: err.source,
						issues: err.issues,
						message: err.message,
					},
				};
			} else if (err instanceof DependencyErrorSignal) {
				result = {
					ok: false as const,
					error: {
						category: "dependency" as const,
						name: err.depName,
						error: err.error,
						message: err.message,
					},
				};
			} else {
				result = {
					ok: false as const,
					error: {
						category: "unexpected" as const,
						error: err,
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}

			// Hook: error
			await this.hookRegistry.emit("error", this.onHookError, result.error, ctx);

			// Hook: pipeline:end
			await this.hookRegistry.emit("pipeline:end", this.onHookError, ctx, result);

			return result;
		}
	}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/router.ts
git commit -m "feat!: rename dispatch hooks to pipeline, add new dispatch:start/end wrapping entire call"
```

---

### Task 3: Update core tests for hook rename

**Files:**
- Modify: `packages/core/__tests__/hooks.test.ts`
- Modify: `packages/core/__tests__/router.test.ts`
- Modify: `packages/core/__tests__/plugin.test.ts`

- [ ] **Step 1: Update hooks.test.ts**

In `hooks.test.ts`, the HookRegistry tests use `"dispatch:start"` and `"dispatch:end"` as generic event names for the registry (which accepts any string). These don't need renaming — the registry is string-based.

The **router hook integration** tests (line 102+) DO need renaming. Change:

- `"dispatch:start"` → `"pipeline:start"` in the following tests:
  - "dispatch:start fires before handler" (line 103) — rename test name to "pipeline:start fires before handler", rename the hook event
  - "hooks do not fire on early validation/routing errors" (line 248) — rename to "pipeline hooks do not fire on early validation/routing errors"
  - "hook errors are forwarded to onHookError" (line 226) — the `dispatch:start` in hook registration changes to `pipeline:start`

- `"dispatch:end"` → `"pipeline:end"` in:
  - "dispatch:end fires after handler with result" (line 124) — rename test and hook event

Add new tests for the new dispatch-level hooks:

```ts
	test("dispatch:start fires before validation", async () => {
		let captured: { workflow: unknown; command: unknown } | undefined;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:start", (workflow, command) => {
			captured = { workflow, command };
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(captured).toBeDefined();
		expect(captured!.workflow).toBe(wf);
		expect(captured!.command).toEqual({ type: "Publish", payload: { title: "Hello" } });
	});

	test("dispatch:end fires after early return (NO_HANDLER)", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:end", (_workflow, _command, result) => {
			capturedResult = result;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(capturedResult).toEqual(result);
		expect(result.ok).toBe(false);
	});

	test("dispatch:end fires after early return (UNKNOWN_STATE)", async () => {
		let hookFired = false;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:end", () => {
			hookFired = true;
		});

		// biome-ignore lint/suspicious/noExplicitAny: intentionally creating invalid workflow
		const badWf = { id: "x", definitionName: "hook-test", state: "nonexistent", data: {}, createdAt: new Date(), updatedAt: new Date() } as any;
		await router.dispatch(badWf, { type: "Publish", payload: { title: "Hello" } });
		expect(hookFired).toBe(true);
	});

	test("dispatch:end fires after early return (command validation)", async () => {
		let hookFired = false;
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});
		router.on("dispatch:end", () => {
			hookFired = true;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid payload
		await router.dispatch(wf, { type: "Publish", payload: {} as any });
		expect(hookFired).toBe(true);
	});

	test("dispatch:end fires after successful pipeline", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});
		router.on("dispatch:end", (_workflow, _command, result) => {
			capturedResult = result;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(capturedResult).toEqual(result);
		expect(result.ok).toBe(true);
	});

	test("dispatch:start fires before pipeline:start", async () => {
		const order: string[] = [];
		const router = new WorkflowRouter(definition);
		router.on("dispatch:start", () => order.push("dispatch:start"));
		router.on("pipeline:start", () => order.push("pipeline:start"));
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(order).toEqual(["dispatch:start", "pipeline:start"]);
	});

	test("dispatch:end fires after pipeline errors (unexpected)", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Publish", () => {
				throw new Error("boom");
			});
		});
		router.on("dispatch:end", (_workflow, _command, result) => {
			capturedResult = result;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(capturedResult).toEqual(result);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.category).toBe("unexpected");
	});

	test("pipeline:end fires before dispatch:end", async () => {
		const order: string[] = [];
		const router = new WorkflowRouter(definition);
		router.on("pipeline:end", () => order.push("pipeline:end"));
		router.on("dispatch:end", () => order.push("dispatch:end"));
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(order).toEqual(["pipeline:end", "dispatch:end"]);
	});
```

- [ ] **Step 2: Update router.test.ts**

Rename all `dispatch:start` → `pipeline:start` and `dispatch:end` → `pipeline:end` in:
- "dispatch:end hook fires on dependency error" test (line 676): `router.on("dispatch:end", ...)` → `router.on("pipeline:end", ...)`
- "dispatch:end hook fires even on unexpected errors" test (line 203): rename both `dispatch:start` and `dispatch:end` hooks to `pipeline:start` and `pipeline:end`

- [ ] **Step 3: Update plugin.test.ts**

Rename in "plugin receives the router and can register hooks" test (line 40):
- `router.on("dispatch:start", ...)` → `router.on("pipeline:start", ...)`
- `router.on("dispatch:end", ...)` → `router.on("pipeline:end", ...)`
- Update the expected log: `["plugin:start", "plugin:end"]` stays the same (the log strings are custom)

- [ ] **Step 4: Run all core tests**

Run: `cd packages/core && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/__tests__/hooks.test.ts packages/core/__tests__/router.test.ts packages/core/__tests__/plugin.test.ts
git commit -m "test: update core tests for hook rename and add dispatch:start/end tests"
```

---

### Task 4: Rebuild core and verify testing package

**Files:**
- None modified — verification only

- [ ] **Step 1: Rebuild core dist**

Run: `cd packages/core && pnpm tsup`
Expected: Build succeeds with CJS + ESM + DTS output

- [ ] **Step 2: Run testing package tests**

Run: `cd packages/testing && pnpm vitest run`
Expected: All 31 tests pass (testing package has no hook references — verified)

- [ ] **Step 3: Run full workspace check**

Run: `pnpm run check`
Expected: All pass

- [ ] **Step 4: Commit and push**

```bash
git push
```

---

### Task 5: Update documentation for hook rename

**Files:**
- Modify: `docs/guide/hooks-and-plugins.md`
- Modify: `docs/guide/observability.md`
- Modify: `docs/guide/error-handling.md`

- [ ] **Step 1: Update hooks-and-plugins.md**

Replace all `dispatch:start` with `pipeline:start` and `dispatch:end` with `pipeline:end` in the code examples (lines 14, 18, 82, 85, 125) since they all use `ReadonlyContext` destructuring.

Update the Hook Events table (lines 37-43) to show all 7 hooks:

```markdown
| Event | When | Parameters |
|-------|------|------------|
| `dispatch:start` | Before any validation | `(workflow, command)` |
| `dispatch:end` | After dispatch completes (always, even early returns) | `(workflow, command, result)` |
| `pipeline:start` | After context created, before handler | `(ctx)` |
| `pipeline:end` | After handler pipeline completes | `(ctx, result)` |
| `transition` | After a state change | `(from, to, workflow)` |
| `error` | On domain, validation, dependency, or unexpected error | `(error, ctx)` |
| `event` | For each emitted event | `(event, workflow)` |
```

Update the guarantee text (line 70):
```
`dispatch:end` is guaranteed to fire whenever `dispatch:start` fires, including early-return errors (UNKNOWN_STATE, command validation, NO_HANDLER). `pipeline:end` is guaranteed to fire whenever `pipeline:start` fires, even if the handler throws an unexpected error.
```

Update the Hooks vs Middleware table context row:
```
| **Context** | Full `Context` | `ReadonlyContext` (pipeline hooks) or raw args (dispatch hooks) |
```

- [ ] **Step 2: Update observability.md**

Replace all `dispatch:start` → `pipeline:start` and `dispatch:end` → `pipeline:end` in the four code examples (lines 15, 18, 43, 47, 94).

Update the guarantee text (line 30):
```
Because `pipeline:end` is guaranteed to fire whenever `pipeline:start` fires, the duration is always recorded — even when the handler throws an unexpected error.
```

Update the audit trail explanation (line 84) to mention `pipeline:end` instead of `dispatch:end`.

- [ ] **Step 3: Update error-handling.md**

Line 95: change `dispatch:end` to `pipeline:end`:
```
`pipeline:end` always fires even when an unexpected error occurs, so hooks and plugins that observe `pipeline:end` will always run.
```

- [ ] **Step 4: Update docs/api/core/src.md**

Update the `HookEvent` type definition and all `on()` overload signatures to reflect the 7-hook system. The `HookEvent` type should show all 7 events. The overloads for `dispatch:start` and `dispatch:end` should show the new signatures `(workflow, command)` and `(workflow, command, result)`. Add `pipeline:start` and `pipeline:end` overloads with the `ReadonlyContext` signatures.

- [ ] **Step 5: Commit and push**

```bash
git add docs/guide/hooks-and-plugins.md docs/guide/observability.md docs/guide/error-handling.md docs/api/core/src.md
git commit -m "docs: update hook references for pipeline:start/end rename"
git push
```

---

## Chunk 2: @rytejs/otel Package Scaffold

### Task 6: Create package boilerplate

**Files:**
- Create: `packages/otel/package.json`
- Create: `packages/otel/tsconfig.json`
- Create: `packages/otel/tsup.config.ts`
- Create: `packages/otel/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
	"name": "@rytejs/otel",
	"version": "0.5.0",
	"description": "OpenTelemetry instrumentation plugin for @rytejs/core",
	"license": "MIT",
	"type": "module",
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js",
			"require": "./dist/index.cjs"
		}
	},
	"main": "./dist/index.cjs",
	"module": "./dist/index.js",
	"types": "./dist/index.d.ts",
	"files": [
		"dist"
	],
	"sideEffects": false,
	"repository": {
		"type": "git",
		"url": "https://github.com/helico-tech/rytejs",
		"directory": "packages/otel"
	},
	"homepage": "https://helico-tech.github.io/rytejs",
	"bugs": "https://github.com/helico-tech/rytejs/issues",
	"keywords": [
		"workflow",
		"state-machine",
		"opentelemetry",
		"tracing",
		"observability"
	],
	"peerDependencies": {
		"@rytejs/core": "workspace:^",
		"@opentelemetry/api": "^1.0.0",
		"@opentelemetry/api-logs": ">=0.200.0"
	},
	"devDependencies": {
		"@rytejs/core": "workspace:*",
		"@opentelemetry/api": "^1.9.0",
		"@opentelemetry/api-logs": ">=0.200.0",
		"@opentelemetry/sdk-trace-node": "^1.30.0",
		"@opentelemetry/sdk-metrics": "^1.30.0",
		"@opentelemetry/sdk-logs": ">=0.200.0",
		"tsup": "^8.0.0",
		"typescript": "^5.7.0",
		"vitest": "^3.0.0",
		"zod": "^4.0.0"
	},
	"scripts": {
		"build": "tsup",
		"test": "vitest run",
		"test:watch": "vitest",
		"typecheck": "tsc --noEmit"
	},
	"engines": {
		"node": ">=18"
	}
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src"
	},
	"include": ["src"],
	"exclude": ["node_modules", "dist", "__tests__"]
}
```

- [ ] **Step 3: Create tsup.config.ts**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

- [ ] **Step 4: Create placeholder src/index.ts**

```ts
export { createOtelPlugin } from "./plugin.js";
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: Lockfile updates, deps install

- [ ] **Step 6: Commit**

```bash
git add packages/otel/package.json packages/otel/tsconfig.json packages/otel/tsup.config.ts packages/otel/src/index.ts
git commit -m "chore: scaffold @rytejs/otel package"
```

---

### Task 7: Implement conventions.ts

**Files:**
- Create: `packages/otel/src/conventions.ts`

- [ ] **Step 1: Write conventions constants**

```ts
// Span names
export const SPAN_NAME_PREFIX = "ryte.dispatch";

// Attribute keys
export const ATTR_WORKFLOW_ID = "ryte.workflow.id";
export const ATTR_WORKFLOW_STATE = "ryte.workflow.state";
export const ATTR_WORKFLOW_DEFINITION = "ryte.workflow.definition";
export const ATTR_COMMAND_TYPE = "ryte.command.type";
export const ATTR_RESULT = "ryte.result";
export const ATTR_ERROR_CATEGORY = "ryte.error.category";
export const ATTR_ERROR_CODE = "ryte.error.code";
export const ATTR_ERROR_SOURCE = "ryte.error.source";
export const ATTR_ERROR_DEPENDENCY = "ryte.error.dependency";
export const ATTR_ERROR_MESSAGE = "ryte.error.message";
export const ATTR_TRANSITION_FROM = "ryte.transition.from";
export const ATTR_TRANSITION_TO = "ryte.transition.to";
export const ATTR_EVENT_TYPE = "ryte.event.type";
export const ATTR_DISPATCH_DURATION_MS = "ryte.dispatch.duration_ms";

// Span event names
export const SPAN_EVENT_TRANSITION = "ryte.transition";
export const SPAN_EVENT_DOMAIN_EVENT = "ryte.event";

// Metric names
export const METRIC_DISPATCH_COUNT = "ryte.dispatch.count";
export const METRIC_DISPATCH_DURATION = "ryte.dispatch.duration";
export const METRIC_TRANSITION_COUNT = "ryte.transition.count";

// Instrumentation scope name
export const SCOPE_NAME = "ryte";
```

- [ ] **Step 2: Commit**

```bash
git add packages/otel/src/conventions.ts
git commit -m "feat: add OTEL naming conventions"
```

---

## Chunk 3: Tracing Implementation (TDD)

### Task 8: Implement tracing.ts

**Files:**
- Create: `packages/otel/src/tracing.ts`
- Create: `packages/otel/src/__tests__/tracing.test.ts`

- [ ] **Step 1: Write failing tracing tests**

Create `packages/otel/src/__tests__/tracing.test.ts`. The tests need an in-memory OTEL SDK setup. Each test creates a router, registers the OTEL plugin, dispatches a command, then asserts on the exported spans.

```ts
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { SpanStatusCode } from "@opentelemetry/api";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createOtelPlugin } from "../plugin.js";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_ERROR_DEPENDENCY,
	ATTR_ERROR_MESSAGE,
	ATTR_ERROR_SOURCE,
	ATTR_WORKFLOW_DEFINITION,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
	SPAN_EVENT_DOMAIN_EVENT,
	SPAN_EVENT_TRANSITION,
	SPAN_NAME_PREFIX,
} from "../conventions.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ total: z.number().optional() }),
		Placed: z.object({ total: z.number() }),
	},
	commands: {
		Place: z.object({ total: z.number() }),
		Cancel: z.object({}),
	},
	events: {
		OrderPlaced: z.object({ id: z.string() }),
	},
	errors: {
		OutOfStock: z.object({ item: z.string() }),
	},
});

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
	exporter = new InMemorySpanExporter();
	provider = new BasicTracerProvider();
	provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
	provider.register();
});

afterEach(async () => {
	await provider.shutdown();
});

function spans() {
	return exporter.getFinishedSpans();
}

describe("tracing", () => {
	test("successful dispatch creates span with correct name and attributes", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
				ctx.emit({ type: "OrderPlaced", data: { id: ctx.workflow.id } });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		expect(spans()).toHaveLength(1);
		const span = spans()[0]!;
		expect(span.name).toBe(`${SPAN_NAME_PREFIX}.Place`);
		expect(span.status.code).toBe(SpanStatusCode.OK);
		expect(span.attributes[ATTR_WORKFLOW_ID]).toBe("ord-1");
		expect(span.attributes[ATTR_WORKFLOW_STATE]).toBe("Draft");
		expect(span.attributes[ATTR_WORKFLOW_DEFINITION]).toBe("order");
		expect(span.attributes[ATTR_COMMAND_TYPE]).toBe("Place");
	});

	test("transition adds span event", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const span = spans()[0]!;
		const transitionEvent = span.events.find((e) => e.name === SPAN_EVENT_TRANSITION);
		expect(transitionEvent).toBeDefined();
		expect(transitionEvent!.attributes!["ryte.transition.from"]).toBe("Draft");
		expect(transitionEvent!.attributes!["ryte.transition.to"]).toBe("Placed");
	});

	test("domain event adds span event", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
				ctx.emit({ type: "OrderPlaced", data: { id: ctx.workflow.id } });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const span = spans()[0]!;
		const domainEvent = span.events.find((e) => e.name === SPAN_EVENT_DOMAIN_EVENT);
		expect(domainEvent).toBeDefined();
		expect(domainEvent!.attributes!["ryte.event.type"]).toBe("OrderPlaced");
	});

	test("domain error sets ERROR status and error attributes", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.error({ code: "OutOfStock", data: { item: "widget" } });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const span = spans()[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("domain");
		expect(span.attributes[ATTR_ERROR_CODE]).toBe("OutOfStock");
	});

	test("unexpected error sets ERROR status", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", () => {
				throw new TypeError("oops");
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const span = spans()[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("unexpected");
		expect(span.attributes[ATTR_ERROR_MESSAGE]).toBe("oops");
	});

	test("validation error sets ERROR status", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		// biome-ignore lint/suspicious/noExplicitAny: intentionally invalid payload
		await router.dispatch(wf, { type: "Place", payload: {} as any });

		const span = spans()[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("validation");
		expect(span.attributes[ATTR_ERROR_SOURCE]).toBe("command");
	});

	test("dependency error sets ERROR status", async () => {
		const deps = { db: { save: () => { throw new Error("down"); } } };
		const router = new WorkflowRouter(definition, deps);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", ({ deps }) => { deps.db.save(); });
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const span = spans()[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("dependency");
		expect(span.attributes[ATTR_ERROR_DEPENDENCY]).toBe("db");
	});

	test("router error (NO_HANDLER) creates span with ERROR status", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const span = spans()[0]!;
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes[ATTR_ERROR_CATEGORY]).toBe("router");
		expect(span.attributes[ATTR_ERROR_CODE]).toBe("NO_HANDLER");
	});

	test("span ends even when handler throws", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", () => { throw new Error("boom"); });
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		expect(spans()).toHaveLength(1);
		expect(spans()[0]!.endTime).toBeDefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/otel && pnpm vitest run`
Expected: FAIL — `createOtelPlugin` not found (plugin.ts doesn't exist yet)

- [ ] **Step 3: Write tracing.ts**

```ts
import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import type { DispatchResult, PipelineError, Workflow, WorkflowConfig } from "@rytejs/core";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_ERROR_DEPENDENCY,
	ATTR_ERROR_MESSAGE,
	ATTR_ERROR_SOURCE,
	ATTR_EVENT_TYPE,
	ATTR_TRANSITION_FROM,
	ATTR_TRANSITION_TO,
	ATTR_WORKFLOW_DEFINITION,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
	SPAN_EVENT_DOMAIN_EVENT,
	SPAN_EVENT_TRANSITION,
	SPAN_NAME_PREFIX,
} from "./conventions.js";

export interface SpanEntry {
	span: Span;
	startTime: number;
}

export function setSpanAttributes(
	span: Span,
	workflow: Workflow,
	command: { type: string; payload: unknown },
): void {
	span.setAttribute(ATTR_WORKFLOW_ID, workflow.id);
	span.setAttribute(ATTR_WORKFLOW_STATE, workflow.state);
	span.setAttribute(ATTR_WORKFLOW_DEFINITION, workflow.definitionName);
	span.setAttribute(ATTR_COMMAND_TYPE, command.type as string);
}

export function addTransitionEvent(span: Span, from: string, to: string): void {
	span.addEvent(SPAN_EVENT_TRANSITION, {
		[ATTR_TRANSITION_FROM]: from,
		[ATTR_TRANSITION_TO]: to,
	});
}

export function addDomainEventEvent(span: Span, eventType: string): void {
	span.addEvent(SPAN_EVENT_DOMAIN_EVENT, {
		[ATTR_EVENT_TYPE]: eventType,
	});
}

export function setErrorAttributes(span: Span, error: PipelineError): void {
	span.setAttribute(ATTR_ERROR_CATEGORY, error.category);
	if ("code" in error) {
		span.setAttribute(ATTR_ERROR_CODE, error.code as string);
	}
	if ("source" in error) {
		span.setAttribute(ATTR_ERROR_SOURCE, error.source);
	}
	if (error.category === "dependency") {
		span.setAttribute(ATTR_ERROR_DEPENDENCY, error.name);
	}
	if ("message" in error) {
		span.setAttribute(ATTR_ERROR_MESSAGE, error.message);
	}
}

export function endSpan(span: Span, result: DispatchResult): void {
	if (result.ok) {
		span.setStatus({ code: SpanStatusCode.OK });
	} else {
		const description =
			"message" in result.error
				? result.error.message
				: "code" in result.error
					? (result.error.code as string)
					: result.error.category;
		span.setStatus({ code: SpanStatusCode.ERROR, message: description });
		setErrorAttributes(span, result.error);
	}
	span.end();
}

export function spanName(commandType: string): string {
	return `${SPAN_NAME_PREFIX}.${commandType}`;
}
```

- [ ] **Step 4: Write a minimal plugin.ts to make tests runnable**

```ts
import { trace } from "@opentelemetry/api";
import { definePlugin, createKey } from "@rytejs/core";
import type { Span } from "@opentelemetry/api";
import type { WorkflowConfig } from "@rytejs/core";
import { SCOPE_NAME } from "./conventions.js";
import {
	type SpanEntry,
	addDomainEventEvent,
	addTransitionEvent,
	endSpan,
	setSpanAttributes,
	spanName,
} from "./tracing.js";

export interface OtelPluginOptions {
	tracer?: ReturnType<typeof trace.getTracer>;
}

export function createOtelPlugin(options?: OtelPluginOptions) {
	const tracer = options?.tracer ?? trace.getTracer(SCOPE_NAME);
	const spanMap = new Map<string, SpanEntry>();
	const spanKey = createKey<Span>("ryte.otel.span");

	return definePlugin<WorkflowConfig, unknown>((router) => {
		router.on("dispatch:start", (workflow, command) => {
			const existing = spanMap.get(workflow.id);
			if (existing) {
				existing.span.end();
			}
			const span = tracer.startSpan(spanName(command.type as string));
			setSpanAttributes(span, workflow, command as { type: string; payload: unknown });
			spanMap.set(workflow.id, { span, startTime: Date.now() });
		});

		router.on("pipeline:start", (ctx) => {
			const entry = spanMap.get(ctx.workflow.id);
			if (entry) {
				ctx.set(spanKey, entry.span);
			}
		});

		router.on("transition", (from, to, workflow) => {
			const entry = spanMap.get(workflow.id);
			if (entry) {
				addTransitionEvent(entry.span, from as string, to as string);
			}
		});

		router.on("event", (event, workflow) => {
			const entry = spanMap.get(workflow.id);
			if (entry) {
				addDomainEventEvent(entry.span, event.type as string);
			}
		});

		router.on("error", (error, ctx) => {
			const span = ctx.getOrNull(spanKey);
			if (span) {
				// Error attributes are set when span ends in dispatch:end
				// but we can also set them here for immediate visibility
			}
		});

		router.on("dispatch:end", (workflow, _command, result) => {
			const entry = spanMap.get(workflow.id);
			if (entry) {
				endSpan(entry.span, result);
				spanMap.delete(workflow.id);
			}
		});
	});
}
```

Note: this is a minimal plugin that only has tracing. Metrics and logging will be added in later tasks. The full `OtelPluginOptions` type will be expanded then.

- [ ] **Step 5: Rebuild core dist (required for otel package imports)**

Run: `cd packages/core && pnpm tsup`

- [ ] **Step 6: Run tracing tests**

Run: `cd packages/otel && pnpm vitest run src/__tests__/tracing.test.ts`
Expected: All tracing tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/otel/src/tracing.ts packages/otel/src/plugin.ts packages/otel/src/__tests__/tracing.test.ts
git commit -m "feat: implement OTEL tracing with span lifecycle"
git push
```

---

## Chunk 4: Metrics and Logging Implementation (TDD)

### Task 9: Implement metrics.ts

**Files:**
- Create: `packages/otel/src/metrics.ts`
- Create: `packages/otel/src/__tests__/metrics.test.ts`

- [ ] **Step 1: Write failing metrics tests**

Create `packages/otel/src/__tests__/metrics.test.ts`:

```ts
import {
	AggregationTemporality,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createOtelPlugin } from "../plugin.js";
import { METRIC_DISPATCH_COUNT, METRIC_DISPATCH_DURATION, METRIC_TRANSITION_COUNT } from "../conventions.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ total: z.number().optional() }),
		Placed: z.object({ total: z.number() }),
	},
	commands: {
		Place: z.object({ total: z.number() }),
	},
	events: {
		OrderPlaced: z.object({ id: z.string() }),
	},
	errors: {
		OutOfStock: z.object({ item: z.string() }),
	},
});

let metricExporter: InMemoryMetricExporter;
let meterProvider: MeterProvider;
let metricReader: PeriodicExportingMetricReader;
let tracerProvider: BasicTracerProvider;

beforeEach(() => {
	metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
	metricReader = new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: 100,
	});
	meterProvider = new MeterProvider({ readers: [metricReader] });
	tracerProvider = new BasicTracerProvider();
	tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new InMemorySpanExporter()));
	tracerProvider.register();
});

afterEach(async () => {
	await meterProvider.shutdown();
	await tracerProvider.shutdown();
});

async function collectMetrics() {
	await metricReader.forceFlush();
	return metricExporter.getMetrics();
}

function findMetric(name: string, metrics: Awaited<ReturnType<typeof collectMetrics>>) {
	for (const resourceMetrics of metrics) {
		for (const scopeMetrics of resourceMetrics.scopeMetrics) {
			for (const metric of scopeMetrics.metrics) {
				if (metric.descriptor.name === name) return metric;
			}
		}
	}
	return undefined;
}

describe("metrics", () => {
	test("dispatch increments ryte.dispatch.count", async () => {
		const meter = meterProvider.getMeter("ryte");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ meter }));
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const metrics = await collectMetrics();
		const counter = findMetric(METRIC_DISPATCH_COUNT, metrics);
		expect(counter).toBeDefined();
		expect(counter!.dataPoints.length).toBeGreaterThan(0);
		const dp = counter!.dataPoints[0]!;
		expect(dp.value).toBe(1);
		expect(dp.attributes["ryte.command.type"]).toBe("Place");
		expect(dp.attributes["ryte.result"]).toBe("ok");
	});

	test("dispatch records ryte.dispatch.duration", async () => {
		const meter = meterProvider.getMeter("ryte");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ meter }));
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const metrics = await collectMetrics();
		const histogram = findMetric(METRIC_DISPATCH_DURATION, metrics);
		expect(histogram).toBeDefined();
	});

	test("transition increments ryte.transition.count", async () => {
		const meter = meterProvider.getMeter("ryte");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ meter }));
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const metrics = await collectMetrics();
		const counter = findMetric(METRIC_TRANSITION_COUNT, metrics);
		expect(counter).toBeDefined();
		const dp = counter!.dataPoints[0]!;
		expect(dp.value).toBe(1);
		expect(dp.attributes["ryte.transition.from"]).toBe("Draft");
		expect(dp.attributes["ryte.transition.to"]).toBe("Placed");
	});

	test("error dispatch tags counter with error category", async () => {
		const meter = meterProvider.getMeter("ryte");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ meter }));
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.error({ code: "OutOfStock", data: { item: "widget" } });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const metrics = await collectMetrics();
		const counter = findMetric(METRIC_DISPATCH_COUNT, metrics);
		expect(counter).toBeDefined();
		const dp = counter!.dataPoints[0]!;
		expect(dp.attributes["ryte.result"]).toBe("error");
		expect(dp.attributes["ryte.error.category"]).toBe("domain");
	});

	test("early-return errors are counted", async () => {
		const meter = meterProvider.getMeter("ryte");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ meter }));

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const metrics = await collectMetrics();
		const counter = findMetric(METRIC_DISPATCH_COUNT, metrics);
		expect(counter).toBeDefined();
		const dp = counter!.dataPoints[0]!;
		expect(dp.attributes["ryte.result"]).toBe("error");
		expect(dp.attributes["ryte.error.category"]).toBe("router");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/otel && pnpm vitest run src/__tests__/metrics.test.ts`
Expected: FAIL — metrics not recorded yet

- [ ] **Step 3: Write metrics.ts**

```ts
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { DispatchResult, Workflow } from "@rytejs/core";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_RESULT,
	ATTR_TRANSITION_FROM,
	ATTR_TRANSITION_TO,
	ATTR_WORKFLOW_STATE,
	METRIC_DISPATCH_COUNT,
	METRIC_DISPATCH_DURATION,
	METRIC_TRANSITION_COUNT,
} from "./conventions.js";

export interface MetricInstruments {
	dispatchCount: Counter;
	dispatchDuration: Histogram;
	transitionCount: Counter;
}

export function createInstruments(meter: Meter): MetricInstruments {
	return {
		dispatchCount: meter.createCounter(METRIC_DISPATCH_COUNT, {
			description: "Number of workflow dispatches",
		}),
		dispatchDuration: meter.createHistogram(METRIC_DISPATCH_DURATION, {
			description: "Duration of workflow dispatches in milliseconds",
			unit: "ms",
		}),
		transitionCount: meter.createCounter(METRIC_TRANSITION_COUNT, {
			description: "Number of workflow state transitions",
		}),
	};
}

export function recordDispatch(
	instruments: MetricInstruments,
	commandType: string,
	workflowState: string,
	durationMs: number,
	result: DispatchResult,
): void {
	const attrs: Record<string, string> = {
		[ATTR_COMMAND_TYPE]: commandType,
		[ATTR_WORKFLOW_STATE]: workflowState,
		[ATTR_RESULT]: result.ok ? "ok" : "error",
	};
	if (!result.ok) {
		attrs[ATTR_ERROR_CATEGORY] = result.error.category;
	}
	instruments.dispatchCount.add(1, attrs);
	instruments.dispatchDuration.record(durationMs, {
		[ATTR_COMMAND_TYPE]: commandType,
		[ATTR_WORKFLOW_STATE]: workflowState,
		[ATTR_RESULT]: result.ok ? "ok" : "error",
	});
}

export function recordTransition(
	instruments: MetricInstruments,
	from: string,
	to: string,
): void {
	instruments.transitionCount.add(1, {
		[ATTR_TRANSITION_FROM]: from,
		[ATTR_TRANSITION_TO]: to,
	});
}
```

- [ ] **Step 4: Update plugin.ts to include metrics**

Add metrics imports and wire them into the hooks. Update `OtelPluginOptions` to accept `meter`. Add `recordDispatch` to `dispatch:end` and `recordTransition` to `transition`.

The key changes to `plugin.ts`:
- Import `metrics` from `@opentelemetry/api`
- Add `meter` to `OtelPluginOptions`
- Call `createInstruments(meter)` at plugin init
- Call `recordTransition(instruments, from, to)` in the `transition` hook
- Call `recordDispatch(instruments, ...)` in the `dispatch:end` hook

- [ ] **Step 5: Run metrics tests**

Run: `cd packages/otel && pnpm vitest run src/__tests__/metrics.test.ts`
Expected: All metrics tests PASS

- [ ] **Step 6: Run tracing tests still pass**

Run: `cd packages/otel && pnpm vitest run src/__tests__/tracing.test.ts`
Expected: All tracing tests still PASS

- [ ] **Step 7: Commit**

```bash
git add packages/otel/src/metrics.ts packages/otel/src/__tests__/metrics.test.ts packages/otel/src/plugin.ts
git commit -m "feat: implement OTEL metrics (counters + histogram)"
git push
```

---

### Task 10: Implement logging.ts

**Files:**
- Create: `packages/otel/src/logging.ts`
- Create: `packages/otel/src/__tests__/logging.test.ts`

- [ ] **Step 1: Write failing logging tests**

Create `packages/otel/src/__tests__/logging.test.ts`. Uses `@opentelemetry/sdk-logs` with an in-memory exporter.

Tests should cover:
- Successful dispatch emits INFO log with body `"dispatch Place → ok"`
- Error dispatch emits WARN log
- Unexpected/dependency errors emit ERROR severity
- Early-return errors emit logs via dispatch:end
- Log attributes include `ryte.command.type`, `ryte.workflow.id`, `ryte.result`, duration

The exact test structure follows the same pattern as metrics — set up in-memory SDK, dispatch, collect logs, assert.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/otel && pnpm vitest run src/__tests__/logging.test.ts`
Expected: FAIL

- [ ] **Step 3: Write logging.ts**

```ts
import type { Logger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { DispatchResult, PipelineError } from "@rytejs/core";
import {
	ATTR_COMMAND_TYPE,
	ATTR_DISPATCH_DURATION_MS,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_ERROR_DEPENDENCY,
	ATTR_ERROR_SOURCE,
	ATTR_RESULT,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
} from "./conventions.js";

export function emitDispatchLog(
	logger: Logger,
	commandType: string,
	workflowId: string,
	workflowState: string,
	durationMs: number,
	result: DispatchResult,
): void {
	const ok = result.ok;
	const attrs: Record<string, string | number> = {
		[ATTR_COMMAND_TYPE]: commandType,
		[ATTR_WORKFLOW_ID]: workflowId,
		[ATTR_WORKFLOW_STATE]: workflowState,
		[ATTR_RESULT]: ok ? "ok" : "error",
		[ATTR_DISPATCH_DURATION_MS]: durationMs,
	};
	if (!ok) {
		attrs[ATTR_ERROR_CATEGORY] = result.error.category;
		if ("code" in result.error) {
			attrs[ATTR_ERROR_CODE] = result.error.code as string;
		}
	}
	logger.emit({
		severityNumber: ok ? SeverityNumber.INFO : SeverityNumber.WARN,
		severityText: ok ? "INFO" : "WARN",
		body: `dispatch ${commandType} → ${ok ? "ok" : "error"}`,
		attributes: attrs,
	});
}

export function emitErrorLog(logger: Logger, error: PipelineError): void {
	const isHighSeverity = error.category === "unexpected" || error.category === "dependency";
	const body =
		error.category === "domain" && "code" in error
			? `error domain: ${error.code}`
			: `error ${error.category}: ${"message" in error ? error.message : error.category}`;

	const attrs: Record<string, string> = {
		[ATTR_ERROR_CATEGORY]: error.category,
	};
	if ("code" in error) attrs[ATTR_ERROR_CODE] = error.code as string;
	if ("source" in error) attrs[ATTR_ERROR_SOURCE] = error.source;
	if (error.category === "dependency") attrs[ATTR_ERROR_DEPENDENCY] = error.name;

	logger.emit({
		severityNumber: isHighSeverity ? SeverityNumber.ERROR : SeverityNumber.WARN,
		severityText: isHighSeverity ? "ERROR" : "WARN",
		body,
		attributes: attrs,
	});
}
```

- [ ] **Step 4: Update plugin.ts to include logging**

Add `@opentelemetry/api-logs` imports. Add `logger` to `OtelPluginOptions`. Call `emitDispatchLog` in `dispatch:end` hook, `emitErrorLog` in `error` hook.

- [ ] **Step 5: Run all otel tests**

Run: `cd packages/otel && pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/otel/src/logging.ts packages/otel/src/__tests__/logging.test.ts packages/otel/src/plugin.ts
git commit -m "feat: implement OTEL structured logging"
git push
```

---

## Chunk 5: Plugin Integration Tests and Final Verification

### Task 11: Plugin integration tests

**Files:**
- Create: `packages/otel/src/__tests__/plugin.test.ts`

- [ ] **Step 1: Write integration tests**

```ts
import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createOtelPlugin } from "../plugin.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({}),
		Placed: z.object({ total: z.number() }),
	},
	commands: {
		Place: z.object({ total: z.number() }),
	},
	events: {},
	errors: {},
});

describe("createOtelPlugin integration", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new BasicTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		provider.register();
	});

	afterEach(async () => {
		await provider.shutdown();
	});

	test("zero-config works with global OTEL API", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		expect(exporter.getFinishedSpans()).toHaveLength(1);
	});

	test("custom tracer override is used", async () => {
		const customTracer = trace.getTracer("custom-scope");
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin({ tracer: customTracer }));
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Place", payload: { total: 42 } });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0]!.instrumentationLibrary.name).toBe("custom-scope");
	});

	test("multiple dispatches create independent spans", async () => {
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf1 = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		const wf2 = definition.createWorkflow("ord-2", { initialState: "Draft", data: {} });
		await router.dispatch(wf1, { type: "Place", payload: { total: 10 } });
		await router.dispatch(wf2, { type: "Place", payload: { total: 20 } });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(2);
		expect(spans[0]!.attributes["ryte.workflow.id"]).toBe("ord-1");
		expect(spans[1]!.attributes["ryte.workflow.id"]).toBe("ord-2");
	});

	test("no-op when no SDK is registered", async () => {
		await provider.shutdown();
		const router = new WorkflowRouter(definition);
		router.use(createOtelPlugin());
		router.state("Draft", ({ on }) => {
			on("Place", (ctx) => {
				ctx.transition("Placed", { total: ctx.command.payload.total });
			});
		});

		const wf = definition.createWorkflow("ord-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Place", payload: { total: 42 } });
		expect(result.ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run integration tests**

Run: `cd packages/otel && pnpm vitest run src/__tests__/plugin.test.ts`
Expected: All PASS

- [ ] **Step 3: Run all otel tests**

Run: `cd packages/otel && pnpm vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/otel/src/__tests__/plugin.test.ts
git commit -m "test: add OTEL plugin integration tests"
```

---

### Task 12: Final typecheck, build, and full workspace verification

**Files:**
- None modified — verification only

- [ ] **Step 1: Typecheck otel package**

Run: `cd packages/otel && pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Build otel package**

Run: `cd packages/otel && pnpm tsup`
Expected: Build succeeds (CJS + ESM + DTS)

- [ ] **Step 3: Lint**

Run: `pnpm biome check .`
Expected: No errors (may need `--fix` for import sorting)

- [ ] **Step 4: Full workspace check**

Run: `pnpm run check`
Expected: All pass (typecheck + test + lint across all packages)

- [ ] **Step 5: Commit and push**

```bash
git push
```
