# Phase 1: Introspect & Extend (v0.2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transition targets, introspection API, lifecycle hooks, plugin system, and `@rytejs/viz` to the Ryte workflow engine.

**Architecture:** The core package gains four new modules: `introspection.ts` (types + definition inspect), `hooks.ts` (hook registry), `plugin.ts` (definePlugin + branding), and `readonly-context.ts` (ReadonlyContext type). The router is modified to support targets on handlers, hook registration via `.on()` overloads, hook emission during dispatch, and plugin discrimination in `.use()`. A new `packages/viz` companion package provides Mermaid/D2 diagram generation from introspection output.

**Tech Stack:** TypeScript 5.7+, Zod 4.x, Vitest 3.x, tsup 8.x, pnpm workspaces, Biome 2.x

---

## File Structure

### Modified Files
- `packages/core/src/router.ts` — HandlerEntry gains `targets`, StateBuilder.on() gains targets overload, WorkflowRouter gets hook overloads on `.on()`, `.use()` plugin discrimination, `inspect()`, router options, hook emission in dispatch
- `packages/core/src/context.ts` — no changes needed (ReadonlyContext is a derived type)
- `packages/core/src/definition.ts` — add `inspect()` method to WorkflowDefinition interface and implementation
- `packages/core/src/types.ts` — no changes needed for Phase 1
- `packages/core/src/index.ts` — export new types and functions

### New Files (core)
- `packages/core/src/introspection.ts` — `DefinitionInfo`, `RouterGraph`, `TransitionInfo` types
- `packages/core/src/hooks.ts` — `HookRegistry` class, `HookMap` type, `HookEvent` type, `HOOK_EVENTS` set
- `packages/core/src/plugin.ts` — `PLUGIN_SYMBOL`, `Plugin` type, `definePlugin()`, `isPlugin()`
- `packages/core/src/readonly-context.ts` — `ReadonlyContext` type alias

### New Test Files (core)
- `packages/core/__tests__/targets.test.ts`
- `packages/core/__tests__/introspection.test.ts`
- `packages/core/__tests__/hooks.test.ts`
- `packages/core/__tests__/plugin.test.ts`

### New Package: `packages/viz`
- `packages/viz/package.json`
- `packages/viz/tsconfig.json`
- `packages/viz/tsup.config.ts`
- `packages/viz/src/index.ts`
- `packages/viz/src/types.ts`
- `packages/viz/src/mermaid.ts`
- `packages/viz/src/d2.ts`
- `packages/viz/__tests__/mermaid.test.ts`
- `packages/viz/__tests__/d2.test.ts`

---

## Chunk 1: Transition Targets + Introspection

### Task 1: Transition Targets on Handler Registration

Add optional `targets` to `HandlerEntry` and support a `{ targets: [...] }` options object in `StateBuilder.on()` and `WorkflowRouter.on("*", ...)`.

**Files:**
- Modify: `packages/core/src/router.ts:20` (HandlerEntry), `packages/core/src/router.ts:26-38` (StateBuilder.on), `packages/core/src/router.ts:157-176` (wildcard on)
- Create: `packages/core/__tests__/targets.test.ts`

- [ ] **Step 1: Write failing tests for targets**

Create `packages/core/__tests__/targets.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("targets-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Review: z.object({ title: z.string(), submittedBy: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		Submit: z.object({ submittedBy: z.string() }),
		Publish: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		Submitted: z.object({ id: z.string() }),
	},
	errors: {},
});

describe("transition targets", () => {
	test("state handler accepts targets option", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Submit", { targets: ["Review"] }, (ctx) => {
				ctx.transition("Review", {
					title: ctx.data.title ?? "untitled",
					submittedBy: ctx.command.payload.submittedBy,
				});
			});
		});
		// Should not throw
	});

	test("state handler works without targets (backward compatible)", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Submit", (ctx) => {
				ctx.transition("Review", {
					title: ctx.data.title ?? "untitled",
					submittedBy: ctx.command.payload.submittedBy,
				});
			});
		});
		// Should not throw
	});

	test("state handler with targets and inline middleware", () => {
		const log: string[] = [];
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on(
				"Submit",
				{ targets: ["Review"] },
				async (ctx, next) => {
					log.push("middleware");
					await next();
				},
				(ctx) => {
					log.push("handler");
					ctx.transition("Review", {
						title: ctx.data.title ?? "untitled",
						submittedBy: ctx.command.payload.submittedBy,
					});
				},
			);
		});
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		return router
			.dispatch(wf, { type: "Submit", payload: { submittedBy: "alice" } })
			.then((result) => {
				expect(result.ok).toBe(true);
				expect(log).toEqual(["middleware", "handler"]);
			});
	});

	test("wildcard handler accepts targets option", () => {
		const router = new WorkflowRouter(definition);
		router.on("*", "Archive", { targets: ["Archived"] }, (ctx) => {
			ctx.transition("Archived", { reason: ctx.command.payload.reason });
		});
		// Should not throw
	});

	test("targets are stored on handler entry and accessible internally", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Submit", { targets: ["Review"] }, (ctx) => {
				ctx.transition("Review", {
					title: "t",
					submittedBy: ctx.command.payload.submittedBy,
				});
			});
		});
		// We'll verify targets via the inspect() API in Task 4
		// For now, just verify the handler dispatches correctly
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		return router
			.dispatch(wf, { type: "Submit", payload: { submittedBy: "alice" } })
			.then((result) => {
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.workflow.state).toBe("Review");
				}
			});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/targets.test.ts`
Expected: FAIL — targets options object is treated as a middleware function

- [ ] **Step 3: Add targets to HandlerEntry and update StateBuilder.on()**

In `packages/core/src/router.ts`, update the `HandlerEntry` type (line 20):

```ts
type HandlerEntry = {
	inlineMiddleware: AnyMiddleware[];
	handler: AnyMiddleware;
	targets?: string[];
};
```

Update `StateBuilder.on()` implementation (lines 26-38) to detect an options object:

```ts
on<C extends CommandNames<TConfig>>(
	command: C,
	options: { targets: readonly StateNames<TConfig>[] },
	...fns: [...AnyMiddleware[], (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>]
): this;
on<C extends CommandNames<TConfig>>(
	command: C,
	...fns: [...AnyMiddleware[], (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>]
): this;
on(command: string, ...fns: unknown[]): this {
	// biome-ignore lint/suspicious/noExplicitAny: runtime type discrimination for options object
	const args = [...fns] as any[];
	let targets: string[] | undefined;
	if (
		args.length > 0 &&
		typeof args[0] === "object" &&
		args[0] !== null &&
		"targets" in args[0]
	) {
		targets = (args.shift() as { targets: string[] }).targets;
	}
	if (args.length === 0) throw new Error("on() requires at least a handler");
	const handler = args.pop() as AnyHandler;
	const inlineMiddleware = args as AnyMiddleware[];
	const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
		await handler(ctx);
	};
	this.handlers.set(command as string, { inlineMiddleware, handler: wrappedHandler, targets });
	return this;
}
```

Update `WorkflowRouter.on()` wildcard method (lines 157-176) similarly. Note: the full overload set for `.on()` (including hooks) is defined in Task 7. For now, replace with an implementation that supports targets:

```ts
on<C extends CommandNames<TConfig>>(
	_state: "*",
	command: C,
	...fns: unknown[]
): this {
	// biome-ignore lint/suspicious/noExplicitAny: runtime type discrimination for options object
	const args = [...fns] as any[];
	let targets: string[] | undefined;
	if (
		args.length > 0 &&
		typeof args[0] === "object" &&
		args[0] !== null &&
		"targets" in args[0]
	) {
		targets = (args.shift() as { targets: string[] }).targets;
	}
	if (args.length === 0) throw new Error("on() requires at least a handler");
	const handler = args.pop() as AnyHandler;
	const inlineMiddleware = args as AnyMiddleware[];
	const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
		await handler(ctx);
	};
	this.wildcardHandlers.set(command as string, {
		inlineMiddleware,
		handler: wrappedHandler,
		targets,
	});
	return this;
}
```

Also update `merge()` and `mergeStateBuilders()` to copy targets:

In `merge()` (line 95-98), add targets to the wildcard copy:
```ts
this.wildcardHandlers.set(command, {
	inlineMiddleware: [...entry.inlineMiddleware],
	handler: entry.handler,
	targets: entry.targets ? [...entry.targets] : undefined,
});
```

In `mergeStateBuilders()` (line 118-121), add targets to the handler copy:
```ts
parentBuilder.handlers.set(command, {
	inlineMiddleware: [...entry.inlineMiddleware],
	handler: entry.handler,
	targets: entry.targets ? [...entry.targets] : undefined,
});
```

- [ ] **Step 4: Run all tests to verify targets work and existing tests pass**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS (targets tests + all existing tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router.ts packages/core/__tests__/targets.test.ts
git commit -m "feat: add transition targets on handler registration"
```

---

### Task 2: Introspection Types + Definition-Level Inspect

Create introspection type definitions and add `inspect()` to `WorkflowDefinition`.

**Files:**
- Create: `packages/core/src/introspection.ts`
- Modify: `packages/core/src/definition.ts:5-17` (WorkflowDefinition interface), `packages/core/src/definition.ts:26-77` (defineWorkflow impl)
- Create: `packages/core/__tests__/introspection.test.ts`

- [ ] **Step 1: Create introspection types**

Create `packages/core/src/introspection.ts`:

```ts
import type {
	CommandNames,
	ErrorCodes,
	EventNames,
	StateNames,
	WorkflowConfig,
} from "./types.js";

/** Static shape of a workflow definition — states, commands, events, errors. */
export interface DefinitionInfo<TConfig extends WorkflowConfig> {
	readonly name: string;
	readonly states: readonly StateNames<TConfig>[];
	readonly commands: readonly CommandNames<TConfig>[];
	readonly events: readonly EventNames<TConfig>[];
	readonly errors: readonly ErrorCodes<TConfig>[];
}

/** A single transition edge in the workflow graph. */
export interface TransitionInfo<TConfig extends WorkflowConfig> {
	readonly from: StateNames<TConfig>;
	readonly command: CommandNames<TConfig>;
	readonly to: readonly StateNames<TConfig>[];
}

/** Full transition graph of a router — includes the definition info plus transitions. */
export interface RouterGraph<TConfig extends WorkflowConfig> {
	readonly definition: DefinitionInfo<TConfig>;
	readonly transitions: readonly TransitionInfo<TConfig>[];
}
```

- [ ] **Step 2: Write failing tests for definition-level inspect**

Add to `packages/core/__tests__/introspection.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Shipped: z.object({ items: z.array(z.string()), trackingId: z.string() }),
		Cancelled: z.object({ reason: z.string() }),
	},
	commands: {
		PlaceOrder: z.object({}),
		ShipOrder: z.object({ trackingId: z.string() }),
		CancelOrder: z.object({ reason: z.string() }),
	},
	events: {
		OrderPlaced: z.object({ id: z.string() }),
		OrderShipped: z.object({ id: z.string() }),
	},
	errors: {
		OutOfStock: z.object({ item: z.string() }),
	},
});

describe("definition.inspect()", () => {
	test("returns all state names", () => {
		const info = definition.inspect();
		expect(info.states).toEqual(
			expect.arrayContaining(["Draft", "Placed", "Shipped", "Cancelled"]),
		);
		expect(info.states).toHaveLength(4);
	});

	test("returns all command names", () => {
		const info = definition.inspect();
		expect(info.commands).toEqual(
			expect.arrayContaining(["PlaceOrder", "ShipOrder", "CancelOrder"]),
		);
		expect(info.commands).toHaveLength(3);
	});

	test("returns all event names", () => {
		const info = definition.inspect();
		expect(info.events).toEqual(expect.arrayContaining(["OrderPlaced", "OrderShipped"]));
		expect(info.events).toHaveLength(2);
	});

	test("returns all error codes", () => {
		const info = definition.inspect();
		expect(info.errors).toEqual(["OutOfStock"]);
	});

	test("includes definition name", () => {
		const info = definition.inspect();
		expect(info.name).toBe("order");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/core && npx vitest run __tests__/introspection.test.ts`
Expected: FAIL — `definition.inspect is not a function`

- [ ] **Step 4: Implement definition-level inspect**

In `packages/core/src/definition.ts`, add the import and update the interface:

Add import at top:
```ts
import type { DefinitionInfo } from "./introspection.js";
```

Add to `WorkflowDefinition` interface (after `hasState`):
```ts
inspect(): DefinitionInfo<TConfig>;
```

Add implementation in the returned object inside `defineWorkflow()` (after `hasState`):
```ts
inspect(): DefinitionInfo<TConfig> {
	return {
		name,
		states: Object.keys(config.states) as StateNames<TConfig>[],
		commands: Object.keys(config.commands) as CommandNames<TConfig>[],
		events: Object.keys(config.events) as EventNames<TConfig>[],
		errors: Object.keys(config.errors) as ErrorCodes<TConfig>[],
	};
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run __tests__/introspection.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Run all tests to verify no regressions**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/introspection.ts packages/core/src/definition.ts packages/core/__tests__/introspection.test.ts
git commit -m "feat: add introspection types and definition-level inspect()"
```

---

### Task 3: Router-Level Inspect

Add `inspect()` to `WorkflowRouter` that returns the transition graph built from handler registrations and their declared targets.

**Files:**
- Modify: `packages/core/src/router.ts` (add `inspect()` method)
- Modify: `packages/core/__tests__/introspection.test.ts` (add router tests)

- [ ] **Step 1: Write failing tests for router inspect**

Append to `packages/core/__tests__/introspection.test.ts`:

```ts
describe("router.inspect()", () => {
	test("returns transitions from handlers with targets", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});
		router.state("Placed", (state) => {
			state.on("ShipOrder", { targets: ["Shipped"] }, (ctx) => {
				ctx.transition("Shipped", {
					items: ctx.data.items,
					trackingId: ctx.command.payload.trackingId,
				});
			});
		});

		const graph = router.inspect();
		expect(graph.definition.name).toBe("order");
		expect(graph.transitions).toEqual(
			expect.arrayContaining([
				{ from: "Draft", command: "PlaceOrder", to: ["Placed"] },
				{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
				{ from: "Placed", command: "ShipOrder", to: ["Shipped"] },
			]),
		);
		expect(graph.transitions).toHaveLength(3);
	});

	test("handlers without targets produce empty to array", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
		});

		const graph = router.inspect();
		expect(graph.transitions).toEqual([{ from: "Draft", command: "PlaceOrder", to: [] }]);
	});

	test("includes wildcard handler transitions", () => {
		const router = new WorkflowRouter(definition);
		router.on("*", "CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
			ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
		});

		const graph = router.inspect();
		// Wildcard handlers produce a transition for each state
		const cancelTransitions = graph.transitions.filter((t) => t.command === "CancelOrder");
		expect(cancelTransitions).toHaveLength(4); // one per state
		for (const t of cancelTransitions) {
			expect(t.to).toEqual(["Cancelled"]);
		}
	});

	test("includes multi-state handler transitions", () => {
		const router = new WorkflowRouter(definition);
		router.state(["Draft", "Placed"] as const, (state) => {
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});

		const graph = router.inspect();
		const cancelTransitions = graph.transitions.filter((t) => t.command === "CancelOrder");
		expect(cancelTransitions).toEqual(
			expect.arrayContaining([
				{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
				{ from: "Placed", command: "CancelOrder", to: ["Cancelled"] },
			]),
		);
		expect(cancelTransitions).toHaveLength(2);
	});

	test("wildcard does not duplicate transitions for states with specific handlers", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});
		router.on("*", "CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
			ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
		});

		const graph = router.inspect();
		const cancelDraft = graph.transitions.filter(
			(t) => t.from === "Draft" && t.command === "CancelOrder",
		);
		expect(cancelDraft).toHaveLength(1); // Only the specific handler, not duplicated by wildcard
	});

	test("includes definition info in graph", () => {
		const router = new WorkflowRouter(definition);
		const graph = router.inspect();
		expect(graph.definition).toEqual(definition.inspect());
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/introspection.test.ts`
Expected: FAIL — `router.inspect is not a function`

- [ ] **Step 3: Implement router inspect**

In `packages/core/src/router.ts`, add import:
```ts
import type { RouterGraph, TransitionInfo } from "./introspection.js";
```

Add `inspect()` method to `WorkflowRouter` class (after the `state()` method):

```ts
/** Returns the transition graph built from registered handlers and their declared targets. */
inspect(): RouterGraph<TConfig> {
	const transitions: TransitionInfo<TConfig>[] = [];
	const allStates = Object.keys(this.definition.config.states) as StateNames<TConfig>[];

	// Single-state handlers
	for (const [stateName, builder] of this.singleStateBuilders) {
		for (const [command, entry] of builder.handlers) {
			transitions.push({
				from: stateName as StateNames<TConfig>,
				command: command as CommandNames<TConfig>,
				to: (entry.targets ?? []) as StateNames<TConfig>[],
			});
		}
	}

	// Multi-state handlers
	for (const [stateName, builder] of this.multiStateBuilders) {
		for (const [command, entry] of builder.handlers) {
			// Only add if not already covered by a single-state handler
			const hasSingle = this.singleStateBuilders.get(stateName)?.handlers.has(command);
			if (!hasSingle) {
				transitions.push({
					from: stateName as StateNames<TConfig>,
					command: command as CommandNames<TConfig>,
					to: (entry.targets ?? []) as StateNames<TConfig>[],
				});
			}
		}
	}

	// Wildcard handlers — produce a transition for each state not already covered
	for (const [command, entry] of this.wildcardHandlers) {
		for (const stateName of allStates) {
			const hasSingle = this.singleStateBuilders.get(stateName)?.handlers.has(command);
			const hasMulti = this.multiStateBuilders.get(stateName)?.handlers.has(command);
			if (!hasSingle && !hasMulti) {
				transitions.push({
					from: stateName,
					command: command as CommandNames<TConfig>,
					to: (entry.targets ?? []) as StateNames<TConfig>[],
				});
			}
		}
	}

	return {
		definition: this.definition.inspect(),
		transitions,
	};
}
```

- [ ] **Step 4: Run all tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router.ts packages/core/__tests__/introspection.test.ts
git commit -m "feat: add router-level inspect() for transition graph"
```

---

### Task 4: Export Introspection Types

Add new public exports to the barrel file.

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

Add to `packages/core/src/index.ts`:

```ts
export type { DefinitionInfo, RouterGraph, TransitionInfo } from "./introspection.js";
```

- [ ] **Step 2: Run typecheck and tests**

Run: `cd packages/core && npx tsc --noEmit && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export introspection types"
```

---

## Chunk 2: Hooks & Plugins

### Task 5: ReadonlyContext Type

Create the `ReadonlyContext` type used by hook callbacks.

**Files:**
- Create: `packages/core/src/readonly-context.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create ReadonlyContext type**

Create `packages/core/src/readonly-context.ts`:

```ts
import type { Context } from "./context.js";
import type { CommandNames, StateNames, WorkflowConfig } from "./types.js";

/**
 * Read-only subset of Context for hook callbacks.
 * Includes context-key access (set/get) but excludes dispatch mutation methods.
 */
export type ReadonlyContext<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig> = StateNames<TConfig>,
	TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> = Omit<Context<TConfig, TDeps, TState, TCommand>, "update" | "transition" | "emit" | "error" | "getWorkflowSnapshot">;
```

- [ ] **Step 2: Add export**

Add to `packages/core/src/index.ts`:
```ts
export type { ReadonlyContext } from "./readonly-context.js";
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/readonly-context.ts packages/core/src/index.ts
git commit -m "feat: add ReadonlyContext type for hook callbacks"
```

---

### Task 6: Hook Registry

Create the internal hook registry that stores and executes hook callbacks.

**Files:**
- Create: `packages/core/src/hooks.ts`
- Create: `packages/core/__tests__/hooks.test.ts`

- [ ] **Step 1: Write failing tests for hook registry**

Create `packages/core/__tests__/hooks.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { HookRegistry } from "../src/hooks.js";

describe("HookRegistry", () => {
	test("registers and emits a hook", async () => {
		const registry = new HookRegistry();
		const callback = vi.fn();
		registry.add("dispatch:start", callback);

		await registry.emit("dispatch:start", console.error, "arg1", "arg2");
		expect(callback).toHaveBeenCalledWith("arg1", "arg2");
	});

	test("multiple callbacks run in registration order", async () => {
		const registry = new HookRegistry();
		const order: number[] = [];
		registry.add("dispatch:start", () => order.push(1));
		registry.add("dispatch:start", () => order.push(2));
		registry.add("dispatch:start", () => order.push(3));

		await registry.emit("dispatch:start", console.error);
		expect(order).toEqual([1, 2, 3]);
	});

	test("hook errors are caught and forwarded to onError", async () => {
		const registry = new HookRegistry();
		const onError = vi.fn();
		const error = new Error("hook failed");
		registry.add("dispatch:start", () => {
			throw error;
		});
		registry.add("dispatch:start", vi.fn()); // second hook should still run

		await registry.emit("dispatch:start", onError);
		expect(onError).toHaveBeenCalledWith(error);
	});

	test("hook errors do not prevent other hooks from running", async () => {
		const registry = new HookRegistry();
		const onError = vi.fn();
		const second = vi.fn();
		registry.add("dispatch:start", () => {
			throw new Error("fail");
		});
		registry.add("dispatch:start", second);

		await registry.emit("dispatch:start", onError);
		expect(second).toHaveBeenCalled();
	});

	test("async hooks are awaited", async () => {
		const registry = new HookRegistry();
		const order: number[] = [];
		registry.add("dispatch:start", async () => {
			await new Promise((r) => setTimeout(r, 10));
			order.push(1);
		});
		registry.add("dispatch:start", () => order.push(2));

		await registry.emit("dispatch:start", console.error);
		expect(order).toEqual([1, 2]);
	});

	test("emitting unregistered hook does nothing", async () => {
		const registry = new HookRegistry();
		// Should not throw
		await registry.emit("dispatch:end", console.error);
	});

	test("merge copies hooks from another registry", () => {
		const parent = new HookRegistry();
		const child = new HookRegistry();
		const callback = vi.fn();
		child.add("transition", callback);

		parent.merge(child);

		return parent.emit("transition", console.error, "a", "b", {}).then(() => {
			expect(callback).toHaveBeenCalledWith("a", "b", {});
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/hooks.test.ts`
Expected: FAIL — cannot import HookRegistry

- [ ] **Step 3: Implement HookRegistry**

Create `packages/core/src/hooks.ts`:

```ts
/** The lifecycle hook event names. */
export type HookEvent =
	| "dispatch:start"
	| "dispatch:end"
	| "transition"
	| "error"
	| "event";

export const HOOK_EVENTS: ReadonlySet<string> = new Set<HookEvent>([
	"dispatch:start",
	"dispatch:end",
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run __tests__/hooks.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hooks.ts packages/core/__tests__/hooks.test.ts
git commit -m "feat: add HookRegistry for lifecycle hook management"
```

---

### Task 7: Hook Integration in Router

Wire the `HookRegistry` into `WorkflowRouter`: add `.on()` overloads for hook registration, router options for `onHookError`, and hook emission during dispatch.

**Files:**
- Modify: `packages/core/src/router.ts` (constructor, `.on()`, `dispatch()`, `merge()`)
- Modify: `packages/core/__tests__/hooks.test.ts` (add integration tests)
- Modify: `packages/core/src/index.ts` (export RouterOptions)

- [ ] **Step 1: Write failing integration tests for hooks on the router**

Append to `packages/core/__tests__/hooks.test.ts`:

```ts
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("hook-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
		Update: z.object({ title: z.string() }),
	},
	events: {
		Published: z.object({ id: z.string() }),
	},
	errors: {
		TitleRequired: z.object({}),
	},
});

describe("router hook integration", () => {
	test("dispatch:start fires before handler", async () => {
		const order: string[] = [];
		const router = new WorkflowRouter(definition);
		router.on("dispatch:start", () => {
			order.push("hook:start");
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				order.push("handler");
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(order).toEqual(["hook:start", "handler"]);
	});

	test("dispatch:end fires after handler with result", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:end", (_ctx, result) => {
			capturedResult = result;
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(capturedResult).toEqual(result);
	});

	test("transition hook fires on state change", async () => {
		let captured: { from: string; to: string } | undefined;
		const router = new WorkflowRouter(definition);
		router.on("transition", (from, to, _workflow) => {
			captured = { from, to };
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(captured).toEqual({ from: "Draft", to: "Published" });
	});

	test("transition hook does not fire on in-place update", async () => {
		const transitionHook = vi.fn();
		const router = new WorkflowRouter(definition);
		router.on("transition", transitionHook);
		router.state("Draft", (state) => {
			state.on("Update", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Update", payload: { title: "Hello" } });
		expect(transitionHook).not.toHaveBeenCalled();
	});

	test("event hook fires for each emitted event", async () => {
		const events: unknown[] = [];
		const router = new WorkflowRouter(definition);
		router.on("event", (event, _workflow) => {
			events.push(event);
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
				ctx.emit({ type: "Published", data: { id: ctx.workflow.id } });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(events).toEqual([{ type: "Published", data: { id: "wf-1" } }]);
	});

	test("error hook fires on domain error", async () => {
		let capturedError: unknown;
		const router = new WorkflowRouter(definition);
		router.on("error", (error, _ctx) => {
			capturedError = error;
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.error({ code: "TitleRequired", data: {} });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(capturedError).toEqual(result.error);
		}
	});

	test("hook errors are forwarded to onHookError", async () => {
		const errors: unknown[] = [];
		const router = new WorkflowRouter(definition, {}, { onHookError: (err) => errors.push(err) });
		const hookError = new Error("hook broke");
		router.on("dispatch:start", () => {
			throw hookError;
		});
		router.state("Draft", (state) => {
			state.on("Update", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Update",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true); // hook error doesn't affect dispatch
		expect(errors).toEqual([hookError]);
	});

	test("hooks do not fire on early validation/routing errors", async () => {
		const startHook = vi.fn();
		const router = new WorkflowRouter(definition);
		router.on("dispatch:start", startHook);
		// No handlers registered

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(false);
		expect(startHook).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/hooks.test.ts`
Expected: FAIL — `router.on("dispatch:start", ...)` doesn't match overload

- [ ] **Step 3: Implement hook integration in router**

In `packages/core/src/router.ts`:

Add imports:
```ts
import { HOOK_EVENTS, HookRegistry } from "./hooks.js";
import type { ReadonlyContext } from "./readonly-context.js";
import type { DispatchResult, PipelineError, Workflow } from "./types.js";
```

Add `RouterOptions` interface (before the class):
```ts
export interface RouterOptions {
	onHookError?: (error: unknown) => void;
}
```

Modify the constructor and add private fields:
```ts
export class WorkflowRouter<TConfig extends WorkflowConfig, TDeps = {}> {
	private globalMiddleware: AnyMiddleware[] = [];
	private singleStateBuilders = new Map<string, StateBuilder<TConfig, TDeps, any>>();
	private multiStateBuilders = new Map<string, StateBuilder<TConfig, TDeps, any>>();
	private wildcardHandlers = new Map<string, HandlerEntry>();
	private hookRegistry = new HookRegistry();
	private readonly onHookError: (error: unknown) => void;

	constructor(
		private readonly definition: WorkflowDefinition<TConfig>,
		private readonly deps: TDeps = {} as TDeps,
		options: RouterOptions = {},
	) {
		this.onHookError = options.onHookError ?? console.error;
	}
```

Replace the existing `on()` method with overloads. The implementation must handle both wildcard handlers and hooks:

```ts
/** Registers a lifecycle hook callback. */
on(event: "dispatch:start", callback: (ctx: ReadonlyContext<TConfig, TDeps>) => void | Promise<void>): this;
on(event: "dispatch:end", callback: (ctx: ReadonlyContext<TConfig, TDeps>, result: DispatchResult<TConfig>) => void | Promise<void>): this;
on(event: "transition", callback: (from: StateNames<TConfig>, to: StateNames<TConfig>, workflow: Workflow<TConfig>) => void | Promise<void>): this;
on(event: "error", callback: (error: PipelineError<TConfig>, ctx: ReadonlyContext<TConfig, TDeps>) => void | Promise<void>): this;
on(event: "event", callback: (event: { type: EventNames<TConfig>; data: unknown }, workflow: Workflow<TConfig>) => void | Promise<void>): this;
/** Registers a wildcard handler that matches any state. */
on<C extends CommandNames<TConfig>>(
	state: "*",
	command: C,
	...fns:
		| [
				{ targets: readonly StateNames<TConfig>[] },
				...AnyMiddleware[],
				(ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
		  ]
		| [
				...AnyMiddleware[],
				(ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
		  ]
): this;
// biome-ignore lint/suspicious/noExplicitAny: implementation signature must be loose to handle all overloads
on(...args: any[]): this {
	const first = args[0] as string;

	if (HOOK_EVENTS.has(first)) {
		this.hookRegistry.add(first, args[1] as Function);
		return this;
	}

	if (first === "*") {
		// Wildcard handler: on("*", command, [options], ...fns)
		const command = args[1] as string;
		const rest = args.slice(2) as unknown[];
		let targets: string[] | undefined;
		if (
			rest.length > 0 &&
			typeof rest[0] === "object" &&
			rest[0] !== null &&
			"targets" in rest[0]
		) {
			targets = (rest.shift() as { targets: string[] }).targets;
		}
		if (rest.length === 0) throw new Error("on() requires at least a handler");
		const handler = rest.pop() as AnyHandler;
		const inlineMiddleware = rest as AnyMiddleware[];
		const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
			await handler(ctx);
		};
		this.wildcardHandlers.set(command, {
			inlineMiddleware,
			handler: wrappedHandler,
			targets,
		});
		return this;
	}

	throw new Error(`Unknown event or state: ${first}`);
}
```

Update `dispatch()` to emit hooks. After the context is created and before executing the chain, emit `dispatch:start`. After execution, emit the appropriate hooks:

```ts
async dispatch(
	workflow: Workflow<TConfig>,
	command: { type: CommandNames<TConfig>; payload: unknown },
): Promise<DispatchResult<TConfig>> {
	// ... existing validation and handler finding (lines 183-240, unchanged) ...

	// ... existing chain building (lines 242-254, unchanged) ...

	const ctx = createContext<TConfig, TDeps>(
		this.definition,
		workflow,
		validatedCommand,
		this.deps,
	);

	// Hook: dispatch:start
	await this.hookRegistry.emit("dispatch:start", this.onHookError, ctx);

	let result: DispatchResult<TConfig>;
	try {
		const composed = compose(chain);
		await composed(ctx);
		result = {
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

		return result;
	} catch (err) {
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
		} else {
			throw err;
		}

		// Hook: error
		await this.hookRegistry.emit("error", this.onHookError, result.error, ctx);

		return result;
	} finally {
		// Hook: dispatch:end — always fires if dispatch:start fired, even on unexpected errors
		if (result!) {
			await this.hookRegistry.emit("dispatch:end", this.onHookError, ctx, result);
		}
	}
}
```

Update `merge()` to also merge the hook registry:
```ts
private merge(child: WorkflowRouter<TConfig, TDeps>): void {
	// ... existing code ...
	this.hookRegistry.merge(child.hookRegistry);
}
```

Add `RouterOptions` export to `packages/core/src/index.ts`:
```ts
export type { RouterOptions } from "./router.js";
```

- [ ] **Step 4: Run all tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router.ts packages/core/src/hooks.ts packages/core/src/readonly-context.ts packages/core/__tests__/hooks.test.ts packages/core/src/index.ts
git commit -m "feat: integrate lifecycle hooks into router dispatch"
```

---

### Task 8: Plugin System

Add `definePlugin()`, `isPlugin()`, and update `.use()` to discriminate plugins from middleware.

**Files:**
- Create: `packages/core/src/plugin.ts`
- Create: `packages/core/__tests__/plugin.test.ts`
- Modify: `packages/core/src/router.ts` (`.use()` method)
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for plugins**

Create `packages/core/__tests__/plugin.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { definePlugin, isPlugin } from "../src/plugin.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("plugin-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
	},
	events: {
		Published: z.object({ id: z.string() }),
	},
	errors: {},
});

describe("definePlugin / isPlugin", () => {
	test("definePlugin brands a function", () => {
		const plugin = definePlugin(() => {});
		expect(isPlugin(plugin)).toBe(true);
	});

	test("plain functions are not plugins", () => {
		const fn = () => {};
		expect(isPlugin(fn)).toBe(false);
	});

	test("non-functions are not plugins", () => {
		expect(isPlugin(42)).toBe(false);
		expect(isPlugin(null)).toBe(false);
		expect(isPlugin("string")).toBe(false);
	});
});

describe("router.use() with plugins", () => {
	test("plugin receives the router and can register hooks", async () => {
		const log: string[] = [];
		const loggingPlugin = definePlugin<typeof definition.config, Record<string, never>>(
			(router) => {
				router.on("dispatch:start", () => {
					log.push("plugin:start");
				});
				router.on("dispatch:end", () => {
					log.push("plugin:end");
				});
			},
		);

		const router = new WorkflowRouter(definition);
		router.use(loggingPlugin);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(log).toEqual(["plugin:start", "plugin:end"]);
	});

	test("plugin can register middleware", async () => {
		const log: string[] = [];
		const authPlugin = definePlugin<typeof definition.config, Record<string, never>>(
			(router) => {
				router.use(async (_ctx, next) => {
					log.push("auth-middleware");
					await next();
				});
			},
		);

		const router = new WorkflowRouter(definition);
		router.use(authPlugin);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				log.push("handler");
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(log).toEqual(["auth-middleware", "handler"]);
	});

	test("use() still works with plain middleware", async () => {
		const log: string[] = [];
		const router = new WorkflowRouter(definition);
		router.use(async (_ctx, next) => {
			log.push("global");
			await next();
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				log.push("handler");
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(log).toEqual(["global", "handler"]);
	});

	test("use() still works with composable routers", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await parent.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/plugin.test.ts`
Expected: FAIL — cannot import definePlugin/isPlugin

- [ ] **Step 3: Implement plugin module**

Create `packages/core/src/plugin.ts`:

```ts
import type { WorkflowRouter } from "./router.js";
import type { WorkflowConfig } from "./types.js";

const PLUGIN_SYMBOL: unique symbol = Symbol.for("ryte:plugin");

/** A branded plugin function that can be passed to router.use(). */
export type Plugin<TConfig extends WorkflowConfig, TDeps> = ((
	router: WorkflowRouter<TConfig, TDeps>,
) => void) & { readonly [PLUGIN_SYMBOL]: true };

/** Brands a function as a Ryte plugin for use with router.use(). */
export function definePlugin<TConfig extends WorkflowConfig, TDeps>(
	fn: (router: WorkflowRouter<TConfig, TDeps>) => void,
): Plugin<TConfig, TDeps> {
	const plugin = fn as Plugin<TConfig, TDeps>;
	Object.defineProperty(plugin, PLUGIN_SYMBOL, { value: true, writable: false });
	return plugin;
}

/** Checks whether a value is a branded Ryte plugin. */
export function isPlugin(value: unknown): value is Plugin<WorkflowConfig, unknown> {
	return typeof value === "function" && PLUGIN_SYMBOL in value;
}
```

- [ ] **Step 4: Update router.use() to discriminate plugins**

In `packages/core/src/router.ts`, add import:
```ts
import { isPlugin } from "./plugin.js";
import type { Plugin } from "./plugin.js";
```

Replace the `use()` method:

```ts
/** Adds global middleware, merges another router, or applies a plugin. */
use(
	arg:
		| ((ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>)
		| WorkflowRouter<TConfig, TDeps>
		| Plugin<TConfig, TDeps>,
): this {
	if (arg instanceof WorkflowRouter) {
		this.merge(arg);
	} else if (isPlugin(arg)) {
		arg(this as WorkflowRouter<TConfig, TDeps>);
	} else {
		this.globalMiddleware.push(arg as AnyMiddleware);
	}
	return this;
}
```

- [ ] **Step 5: Add plugin exports to index.ts**

Add to `packages/core/src/index.ts`:
```ts
export type { Plugin } from "./plugin.js";
export { definePlugin, isPlugin } from "./plugin.js";
export type { HookEvent } from "./hooks.js";
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugin.ts packages/core/__tests__/plugin.test.ts packages/core/src/router.ts packages/core/src/index.ts
git commit -m "feat: add plugin system with definePlugin() and use() discrimination"
```

---

## Chunk 3: @rytejs/viz Package

### Task 9: Package Scaffold

Set up the `packages/viz` package with build tooling.

**Files:**
- Create: `packages/viz/package.json`
- Create: `packages/viz/tsconfig.json`
- Create: `packages/viz/tsup.config.ts`
- Create: `packages/viz/src/index.ts`
- Create: `packages/viz/src/types.ts`

- [ ] **Step 1: Create package.json**

Create `packages/viz/package.json`:

```json
{
	"name": "@rytejs/viz",
	"version": "0.2.0",
	"description": "Generate Mermaid and D2 state diagrams from @rytejs/core workflow definitions",
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
	"files": ["dist"],
	"sideEffects": false,
	"repository": {
		"type": "git",
		"url": "https://github.com/helico-tech/rytejs",
		"directory": "packages/viz"
	},
	"homepage": "https://helico-tech.github.io/rytejs",
	"bugs": "https://github.com/helico-tech/rytejs/issues",
	"keywords": ["workflow", "state-machine", "mermaid", "d2", "diagram", "visualization"],
	"peerDependencies": {
		"@rytejs/core": "workspace:^"
	},
	"devDependencies": {
		"@rytejs/core": "workspace:*",
		"tsup": "^8.0.0",
		"typescript": "^5.7.0",
		"vitest": "^3.0.0",
		"zod": "^4.0.0"
	},
	"scripts": {
		"build": "tsup",
		"test": "vitest run",
		"test:watch": "vitest",
		"test:coverage": "vitest run --coverage",
		"typecheck": "tsc --noEmit"
	},
	"engines": {
		"node": ">=18"
	}
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/viz/tsconfig.json`:

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

Create `packages/viz/tsup.config.ts`:

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

- [ ] **Step 4: Create types.ts with input types**

Create `packages/viz/src/types.ts`:

```ts
/** Minimal transition info needed for diagram generation. */
export interface TransitionEdge {
	readonly from: string;
	readonly command: string;
	readonly to: readonly string[];
}

/**
 * Input for diagram generation functions.
 * Matches the shape returned by WorkflowRouter.inspect().
 */
export interface GraphInput {
	readonly definition: {
		readonly name: string;
		readonly states: readonly string[];
	};
	readonly transitions: readonly TransitionEdge[];
}

/** Options for diagram generation. */
export interface DiagramOptions {
	/** Title for the diagram. Defaults to the definition name. */
	title?: string;
	/** States with no outgoing transitions are highlighted as terminal. */
	highlightTerminal?: boolean;
}
```

- [ ] **Step 5: Create barrel index.ts**

Create `packages/viz/src/index.ts`:

```ts
export { toMermaid } from "./mermaid.js";
export { toD2 } from "./d2.js";
export type { DiagramOptions, GraphInput, TransitionEdge } from "./types.js";
```

- [ ] **Step 6: Update turbo.json if needed**

Check that `turbo.json` already handles the new package. Since `packages/*` is in the workspace and turbo uses `build`, `test`, `typecheck` tasks, it should work automatically.

- [ ] **Step 7: Install dependencies**

Run: `cd /home/ralph/ryte && pnpm install`

- [ ] **Step 8: Commit**

```bash
git add packages/viz/
git commit -m "chore: scaffold @rytejs/viz package"
```

---

### Task 10: toMermaid()

Implement Mermaid stateDiagram-v2 generation from graph input.

**Files:**
- Create: `packages/viz/src/mermaid.ts`
- Create: `packages/viz/__tests__/mermaid.test.ts`

- [ ] **Step 1: Write failing tests for toMermaid**

Create `packages/viz/__tests__/mermaid.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { GraphInput } from "../src/types.js";
import { toMermaid } from "../src/mermaid.js";

const graph: GraphInput = {
	definition: {
		name: "order",
		states: ["Draft", "Placed", "Shipped", "Delivered", "Cancelled"],
	},
	transitions: [
		{ from: "Draft", command: "PlaceOrder", to: ["Placed"] },
		{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
		{ from: "Placed", command: "ShipOrder", to: ["Shipped"] },
		{ from: "Placed", command: "CancelOrder", to: ["Cancelled"] },
		{ from: "Shipped", command: "ConfirmDelivery", to: ["Delivered"] },
	],
};

describe("toMermaid", () => {
	test("generates valid stateDiagram-v2", () => {
		const result = toMermaid(graph);
		expect(result).toContain("stateDiagram-v2");
		expect(result).toContain("Draft --> Placed : PlaceOrder");
		expect(result).toContain("Draft --> Cancelled : CancelOrder");
		expect(result).toContain("Placed --> Shipped : ShipOrder");
		expect(result).toContain("Placed --> Cancelled : CancelOrder");
		expect(result).toContain("Shipped --> Delivered : ConfirmDelivery");
	});

	test("handles multiple targets per transition", () => {
		const g: GraphInput = {
			definition: { name: "test", states: ["A", "B", "C"] },
			transitions: [{ from: "A", command: "Go", to: ["B", "C"] }],
		};
		const result = toMermaid(g);
		expect(result).toContain("A --> B : Go");
		expect(result).toContain("A --> C : Go");
	});

	test("skips transitions with no targets", () => {
		const g: GraphInput = {
			definition: { name: "test", states: ["A", "B"] },
			transitions: [{ from: "A", command: "Noop", to: [] }],
		};
		const result = toMermaid(g);
		expect(result).not.toContain("Noop");
	});

	test("highlights terminal states", () => {
		const result = toMermaid(graph, { highlightTerminal: true });
		// Delivered and Cancelled have no outgoing transitions
		expect(result).toContain("Delivered --> [*]");
		expect(result).toContain("Cancelled --> [*]");
		// Draft has outgoing transitions, should NOT be terminal
		expect(result).not.toContain("Draft --> [*]");
	});

	test("uses custom title", () => {
		const result = toMermaid(graph, { title: "Order Flow" });
		expect(result).toContain("---");
		expect(result).toContain("title: Order Flow");
	});

	test("handles empty transitions", () => {
		const g: GraphInput = {
			definition: { name: "empty", states: ["A"] },
			transitions: [],
		};
		const result = toMermaid(g);
		expect(result).toContain("stateDiagram-v2");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/viz && npx vitest run __tests__/mermaid.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement toMermaid**

Create `packages/viz/src/mermaid.ts`:

```ts
import type { DiagramOptions, GraphInput } from "./types.js";

/**
 * Generates a Mermaid stateDiagram-v2 from a workflow graph.
 * Output is a string of Mermaid source code.
 */
export function toMermaid(graph: GraphInput, options: DiagramOptions = {}): string {
	const lines: string[] = [];

	if (options.title) {
		lines.push("---");
		lines.push(`title: ${options.title}`);
		lines.push("---");
	}

	lines.push("stateDiagram-v2");

	for (const transition of graph.transitions) {
		for (const target of transition.to) {
			lines.push(`    ${transition.from} --> ${target} : ${transition.command}`);
		}
	}

	if (options.highlightTerminal) {
		const statesWithOutgoing = new Set(
			graph.transitions.filter((t) => t.to.length > 0).map((t) => t.from),
		);
		for (const state of graph.definition.states) {
			if (!statesWithOutgoing.has(state)) {
				lines.push(`    ${state} --> [*]`);
			}
		}
	}

	return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/viz && npx vitest run __tests__/mermaid.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/viz/src/mermaid.ts packages/viz/__tests__/mermaid.test.ts
git commit -m "feat: add toMermaid() diagram generation"
```

---

### Task 11: toD2()

Implement D2 diagram generation from graph input.

**Files:**
- Create: `packages/viz/src/d2.ts`
- Create: `packages/viz/__tests__/d2.test.ts`

- [ ] **Step 1: Write failing tests for toD2**

Create `packages/viz/__tests__/d2.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { GraphInput } from "../src/types.js";
import { toD2 } from "../src/d2.js";

const graph: GraphInput = {
	definition: {
		name: "order",
		states: ["Draft", "Placed", "Shipped", "Delivered", "Cancelled"],
	},
	transitions: [
		{ from: "Draft", command: "PlaceOrder", to: ["Placed"] },
		{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
		{ from: "Placed", command: "ShipOrder", to: ["Shipped"] },
		{ from: "Placed", command: "CancelOrder", to: ["Cancelled"] },
		{ from: "Shipped", command: "ConfirmDelivery", to: ["Delivered"] },
	],
};

describe("toD2", () => {
	test("generates valid D2 diagram", () => {
		const result = toD2(graph);
		expect(result).toContain("Draft -> Placed: PlaceOrder");
		expect(result).toContain("Draft -> Cancelled: CancelOrder");
		expect(result).toContain("Placed -> Shipped: ShipOrder");
		expect(result).toContain("Placed -> Cancelled: CancelOrder");
		expect(result).toContain("Shipped -> Delivered: ConfirmDelivery");
	});

	test("handles multiple targets per transition", () => {
		const g: GraphInput = {
			definition: { name: "test", states: ["A", "B", "C"] },
			transitions: [{ from: "A", command: "Go", to: ["B", "C"] }],
		};
		const result = toD2(g);
		expect(result).toContain("A -> B: Go");
		expect(result).toContain("A -> C: Go");
	});

	test("skips transitions with no targets", () => {
		const g: GraphInput = {
			definition: { name: "test", states: ["A", "B"] },
			transitions: [{ from: "A", command: "Noop", to: [] }],
		};
		const result = toD2(g);
		expect(result).not.toContain("Noop");
	});

	test("highlights terminal states", () => {
		const result = toD2(graph, { highlightTerminal: true });
		expect(result).toContain("Delivered.style.fill: \"#e0e0e0\"");
		expect(result).toContain("Cancelled.style.fill: \"#e0e0e0\"");
		expect(result).not.toContain("Draft.style.fill");
	});

	test("uses custom title", () => {
		const result = toD2(graph, { title: "Order Flow" });
		expect(result).toContain("# Order Flow");
	});

	test("handles empty transitions", () => {
		const g: GraphInput = {
			definition: { name: "empty", states: ["A"] },
			transitions: [],
		};
		const result = toD2(g);
		// States are declared even with no transitions
		expect(result).toContain("A");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/viz && npx vitest run __tests__/d2.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement toD2**

Create `packages/viz/src/d2.ts`:

```ts
import type { DiagramOptions, GraphInput } from "./types.js";

/**
 * Generates a D2 diagram from a workflow graph.
 * Output is a string of D2 source code.
 */
export function toD2(graph: GraphInput, options: DiagramOptions = {}): string {
	const lines: string[] = [];

	if (options.title) {
		lines.push(`# ${options.title}`);
		lines.push("");
	}

	// Declare all states
	for (const state of graph.definition.states) {
		lines.push(state);
	}

	if (graph.transitions.length > 0) {
		lines.push("");
	}

	for (const transition of graph.transitions) {
		for (const target of transition.to) {
			lines.push(`${transition.from} -> ${target}: ${transition.command}`);
		}
	}

	if (options.highlightTerminal) {
		const statesWithOutgoing = new Set(
			graph.transitions.filter((t) => t.to.length > 0).map((t) => t.from),
		);
		lines.push("");
		for (const state of graph.definition.states) {
			if (!statesWithOutgoing.has(state)) {
				lines.push(`${state}.style.fill: "#e0e0e0"`);
			}
		}
	}

	return lines.join("\n");
}
```

- [ ] **Step 4: Run all viz tests**

Run: `cd packages/viz && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/viz/src/d2.ts packages/viz/__tests__/d2.test.ts
git commit -m "feat: add toD2() diagram generation"
```

---

### Task 12: Final Integration + Full Test Suite

Run the complete test suite, typecheck, and lint across the entire monorepo.

**Files:**
- Modify: `packages/core/src/index.ts` (verify all exports are present)

- [ ] **Step 1: Verify all core exports are in place**

Ensure `packages/core/src/index.ts` contains all new exports:

```ts
// Existing exports (unchanged)
export type { Context } from "./context.js";
export type { WorkflowDefinition } from "./definition.js";
export { defineWorkflow } from "./definition.js";
export type { Handler } from "./handler.js";
export type { ContextKey } from "./key.js";
export { createKey } from "./key.js";
export type { Middleware } from "./middleware.js";
export { WorkflowRouter } from "./router.js";
export type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	ErrorCodes,
	ErrorData,
	EventData,
	EventNames,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowOf,
} from "./types.js";
export { DomainErrorSignal, ValidationError } from "./types.js";

// New Phase 1 exports
export type { DefinitionInfo, RouterGraph, TransitionInfo } from "./introspection.js";
export type { ReadonlyContext } from "./readonly-context.js";
export type { RouterOptions } from "./router.js";
export type { HookEvent } from "./hooks.js";
export type { Plugin } from "./plugin.js";
export { definePlugin, isPlugin } from "./plugin.js";
```

- [ ] **Step 2: Add cross-package integration test to viz**

Create `packages/viz/__tests__/integration.test.ts` that imports from both `@rytejs/core` and the viz package to verify the real flow:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { toMermaid, toD2 } from "../src/index.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Cancelled: z.object({ reason: z.string() }),
	},
	commands: {
		PlaceOrder: z.object({}),
		CancelOrder: z.object({ reason: z.string() }),
	},
	events: {},
	errors: {},
});

describe("viz integration with @rytejs/core", () => {
	test("router.inspect() output feeds directly into toMermaid()", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
			state.on("CancelOrder", { targets: ["Cancelled"] }, (ctx) => {
				ctx.transition("Cancelled", { reason: ctx.command.payload.reason });
			});
		});

		const graph = router.inspect();
		const mermaid = toMermaid(graph);
		expect(mermaid).toContain("Draft --> Placed : PlaceOrder");
		expect(mermaid).toContain("Draft --> Cancelled : CancelOrder");
	});

	test("router.inspect() output feeds directly into toD2()", () => {
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("PlaceOrder", { targets: ["Placed"] }, (ctx) => {
				ctx.transition("Placed", { items: ctx.data.items, placedAt: new Date() });
			});
		});

		const graph = router.inspect();
		const d2 = toD2(graph);
		expect(d2).toContain("Draft -> Placed: PlaceOrder");
	});
});
```

- [ ] **Step 3: Run full monorepo checks**

Run: `cd /home/ralph/ryte && pnpm run check`
Expected: typecheck, test, and lint all pass

- [ ] **Step 3: Run the build**

Run: `cd /home/ralph/ryte && pnpm run build`
Expected: Both @rytejs/core and @rytejs/viz build successfully

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete Phase 1 — introspection, hooks, plugins, viz"
```

- [ ] **Step 5: Push**

```bash
git push
```
