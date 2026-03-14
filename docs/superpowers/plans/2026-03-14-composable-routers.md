# Composable Routers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `WorkflowRouter.use()` to accept another `WorkflowRouter`, eagerly merging its handlers and middleware into the parent.

**Architecture:** Single change to `WorkflowRouter` — expand `.use()` with an `instanceof` check that triggers a private `merge()` method. The merge copies entries from the child's state builders, wildcard handlers, and global middleware into the parent. Parent wins on handler conflicts. No changes to `StateBuilder`, `dispatch()`, or the middleware pipeline.

**Tech Stack:** TypeScript, Vitest, VitePress (docs)

**Spec:** `docs/superpowers/specs/2026-03-14-composable-routers-design.md`

---

## File Structure

- **Modify:** `packages/core/src/router.ts` — expand `.use()`, add private `merge()` and `mergeStateBuilders()`
- **Create:** `packages/core/__tests__/composable.test.ts` — all composition tests
- **Modify:** `docs/guide/routing-commands.md` — add "Composable Routers" section
- **Modify:** `docs/api/index.md` — update `.use()` signature

---

## Task 1: Tests for basic composition

**Files:**
- Create: `packages/core/__tests__/composable.test.ts`

- [ ] **Step 1: Write tests for basic handler merge and definition mismatch**

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "../src/index.js";

const definition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Review: z.object({ title: z.string(), reviewer: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		SetTitle: z.object({ title: z.string() }),
		Submit: z.object({ reviewer: z.string() }),
		Approve: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		TitleSet: z.object({ title: z.string() }),
		Submitted: z.object({ id: z.string() }),
		Approved: z.object({ id: z.string() }),
	},
	errors: {
		TitleRequired: z.object({}),
	},
});

const wf = {
	Draft: (data: { title?: string } = {}) =>
		definition.createWorkflow("wf-1", { initialState: "Draft", data }),
	Review: (data: { title: string; reviewer: string }) =>
		definition.createWorkflow("wf-1", { initialState: "Review", data }),
};

describe("Composable Routers", () => {
	test("child router's handlers are callable through parent", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const result = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Draft");
		if (result.workflow.state === "Draft") {
			expect(result.workflow.data.title).toBe("Hello");
		}
	});

	test("definition mismatch throws", () => {
		const other = defineWorkflow("other", {
			states: { A: z.object({}) },
			commands: { Do: z.object({}) },
			events: {},
			errors: {},
		});
		const child = new WorkflowRouter(other);
		const parent = new WorkflowRouter(definition);
		expect(() => parent.use(child)).toThrow();
	});

	test("parent wins: parent handler takes priority over child", async () => {
		const log: string[] = [];
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", () => {
				log.push("child");
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.state("Draft", (s) => {
			s.on("SetTitle", () => {
				log.push("parent");
			});
		});
		parent.use(child);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent"]);
	});

	test("eager: mutations to child after .use() do not affect parent", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: "from-child" });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		// Mutate child after merge
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: "mutated" });
			});
		});

		const result = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "x" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		if (result.workflow.state === "Draft") {
			expect(result.workflow.data.title).toBe("from-child");
		}
	});

	test("child can be .use()'d into multiple parents", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent1 = new WorkflowRouter(definition);
		parent1.use(child);

		const parent2 = new WorkflowRouter(definition);
		parent2.use(child);

		const r1 = await parent1.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "p1" },
		});
		const r2 = await parent2.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "p2" },
		});
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(true);
		if (r1.ok && r1.workflow.state === "Draft") expect(r1.workflow.data.title).toBe("p1");
		if (r2.ok && r2.workflow.state === "Draft") expect(r2.workflow.data.title).toBe("p2");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/composable.test.ts`
Expected: FAIL — `.use()` does not accept `WorkflowRouter`

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/core/__tests__/composable.test.ts
git commit -m "test: add failing tests for composable routers (basic)"
```

---

## Task 2: Implement merge in WorkflowRouter

**Files:**
- Modify: `packages/core/src/router.ts`

- [ ] **Step 1: Expand `.use()` and add private `merge()` and `mergeStateBuilders()`**

In `router.ts`, replace the existing `use()` method with:

```ts
/** Adds global middleware or merges another router's handlers. */
use(
	middlewareOrRouter:
		| ((ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>)
		| WorkflowRouter<TConfig, TDeps>,
): this {
	if (middlewareOrRouter instanceof WorkflowRouter) {
		this.merge(middlewareOrRouter);
	} else {
		this.globalMiddleware.push(middlewareOrRouter as AnyMiddleware);
	}
	return this;
}
```

Add these two private methods to `WorkflowRouter`:

```ts
private merge(child: WorkflowRouter<TConfig, TDeps>): void {
	if (child.definition !== this.definition) {
		throw new Error(
			`Cannot merge router for '${child.definition.name}' into router for '${this.definition.name}': definition mismatch`,
		);
	}

	this.globalMiddleware.push(...child.globalMiddleware);
	this.mergeStateBuilders(this.singleStateBuilders, child.singleStateBuilders);
	this.mergeStateBuilders(this.multiStateBuilders, child.multiStateBuilders);

	for (const [command, entry] of child.wildcardHandlers) {
		if (!this.wildcardHandlers.has(command)) {
			this.wildcardHandlers.set(command, {
				inlineMiddleware: [...entry.inlineMiddleware],
				handler: entry.handler,
			});
		}
	}
}

// biome-ignore lint/suspicious/noExplicitAny: type erasure — builders store handlers for different state types
private mergeStateBuilders(
	target: Map<string, StateBuilder<TConfig, TDeps, any>>,
	source: Map<string, StateBuilder<TConfig, TDeps, any>>,
): void {
	for (const [stateName, childBuilder] of source) {
		let parentBuilder = target.get(stateName);
		if (!parentBuilder) {
			// biome-ignore lint/suspicious/noExplicitAny: type erasure — state name is dynamic at runtime
			parentBuilder = new StateBuilder<TConfig, TDeps, any>();
			target.set(stateName, parentBuilder);
		}
		// Parent wins: only copy handlers the parent doesn't have
		for (const [command, entry] of childBuilder.handlers) {
			if (!parentBuilder.handlers.has(command)) {
				parentBuilder.handlers.set(command, {
					inlineMiddleware: [...entry.inlineMiddleware],
					handler: entry.handler,
				});
			}
		}
		// Append child's state middleware after parent's
		parentBuilder.middleware.push(...childBuilder.middleware);
	}
}
```

- [ ] **Step 2: Run Task 1 tests to verify they pass**

Run: `cd packages/core && npx vitest run __tests__/composable.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `cd packages/core && npx vitest run`
Expected: All tests PASS (84 existing + 5 new = 89)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/router.ts
git commit -m "feat: support composable routers via .use(router)"
```

---

## Task 3: Tests for middleware ordering, wildcards, multi-state, and nesting

**Files:**
- Modify: `packages/core/__tests__/composable.test.ts`

- [ ] **Step 1: Add remaining tests**

Append to the existing `describe("Composable Routers", ...)` block:

```ts
	test("child global middleware runs after parent global middleware", async () => {
		const log: string[] = [];
		const child = new WorkflowRouter(definition);
		child.use(async (_ctx, next) => {
			log.push("child-global");
			await next();
		});
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				log.push("handler");
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(async (_ctx, next) => {
			log.push("parent-global");
			await next();
		});
		parent.use(child);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent-global", "child-global", "handler"]);
	});

	test("child state middleware appended after parent state middleware", async () => {
		const log: string[] = [];
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.use(async (_ctx, next) => {
				log.push("child-state");
				await next();
			});
			s.on("SetTitle", (ctx) => {
				log.push("handler");
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.state("Draft", (s) => {
			s.use(async (_ctx, next) => {
				log.push("parent-state");
				await next();
			});
		});
		parent.use(child);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent-state", "child-state", "handler"]);
	});

	test("wildcard handlers from child are merged", async () => {
		const child = new WorkflowRouter(definition);
		child.on("*", "Archive", (ctx) => {
			ctx.transition("Archived", { reason: ctx.command.payload.reason });
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const result = await parent.dispatch(wf.Draft(), {
			type: "Archive",
			payload: { reason: "done" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.workflow.state).toBe("Archived");
	});

	test("multi-state handlers from child are merged", async () => {
		const child = new WorkflowRouter(definition);
		child.state(["Draft", "Review"] as const, (s) => {
			s.on("Archive", (ctx) => {
				ctx.transition("Archived", { reason: ctx.command.payload.reason });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const r1 = await parent.dispatch(wf.Draft(), {
			type: "Archive",
			payload: { reason: "x" },
		});
		expect(r1.ok).toBe(true);
		if (r1.ok) expect(r1.workflow.state).toBe("Archived");

		const r2 = await parent.dispatch(wf.Review({ title: "T", reviewer: "r" }), {
			type: "Archive",
			payload: { reason: "y" },
		});
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.workflow.state).toBe("Archived");
	});

	test("nested composition: router.use(a) where a.use(b)", async () => {
		const b = new WorkflowRouter(definition);
		b.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const a = new WorkflowRouter(definition);
		a.use(b);

		const parent = new WorkflowRouter(definition);
		parent.use(a);

		const result = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "nested" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		if (result.workflow.state === "Draft") {
			expect(result.workflow.data.title).toBe("nested");
		}
	});

	test("multiple children can be composed into one parent", async () => {
		const draftRouter = new WorkflowRouter(definition);
		draftRouter.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const reviewRouter = new WorkflowRouter(definition);
		reviewRouter.state("Review", (s) => {
			s.on("Approve", (ctx) => {
				ctx.transition("Published", {
					title: ctx.data.title,
					publishedAt: new Date(),
				});
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(draftRouter);
		parent.use(reviewRouter);

		const r1 = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "composed" },
		});
		expect(r1.ok).toBe(true);

		const r2 = await parent.dispatch(wf.Review({ title: "T", reviewer: "r" }), {
			type: "Approve",
			payload: {},
		});
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.workflow.state).toBe("Published");
	});

	test("multiple children global middleware runs in .use() order", async () => {
		const log: string[] = [];
		const childA = new WorkflowRouter(definition);
		childA.use(async (_ctx, next) => {
			log.push("A");
			await next();
		});

		const childB = new WorkflowRouter(definition);
		childB.use(async (_ctx, next) => {
			log.push("B");
			await next();
		});
		childB.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				log.push("handler");
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(async (_ctx, next) => {
			log.push("parent");
			await next();
		});
		parent.use(childA);
		parent.use(childB);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent", "A", "B", "handler"]);
	});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run __tests__/composable.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 3: Run full suite + check**

Run: `pnpm check`
Expected: All tests pass, typecheck passes, biome clean

- [ ] **Step 4: Commit**

```bash
git add packages/core/__tests__/composable.test.ts
git commit -m "test: add composition tests for middleware, wildcards, nesting"
```

---

## Task 4: Documentation updates

**Files:**
- Modify: `docs/guide/routing-commands.md`
- Modify: `docs/api/index.md`

- [ ] **Step 1: Add "Composable Routers" section to routing-commands guide**

Append before the "Dispatching Commands" section in `docs/guide/routing-commands.md`:

```markdown
## Composable Routers

Split handler registration across routers and compose them with `.use()`:

\`\`\`ts
const draftRouter = new WorkflowRouter(taskWorkflow);
draftRouter.state("Draft", (state) => {
  state.on("SetTitle", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
  state.on("Submit", (ctx) => {
    ctx.transition("Review", {
      title: ctx.data.title,
      assignee: ctx.command.payload.assignee,
    });
  });
});

const reviewRouter = new WorkflowRouter(taskWorkflow);
reviewRouter.state("Review", (state) => {
  state.on("Approve", (ctx) => {
    ctx.transition("Published", {
      title: ctx.data.title,
      publishedAt: new Date(),
    });
  });
});

const router = new WorkflowRouter(taskWorkflow);
router.use(draftRouter);
router.use(reviewRouter);
\`\`\`

Each child router must use the same workflow definition. The merge is eager -- changes to the child after `.use()` do not affect the parent.

### Handler Priority

When both parent and child register a handler for the same state + command, the parent's handler wins. Child handlers only fill in what the parent doesn't have.

### Middleware Ordering

The child's global middleware is appended after the parent's. State-scoped middleware from the child is appended after the parent's state-scoped middleware for the same state.

### Nested Composition

Routers can be nested arbitrarily:

\`\`\`ts
const inner = new WorkflowRouter(taskWorkflow);
inner.state("Draft", (s) => { ... });

const middle = new WorkflowRouter(taskWorkflow);
middle.use(inner);

const outer = new WorkflowRouter(taskWorkflow);
outer.use(middle);
\`\`\`
```

- [ ] **Step 2: Update `.use()` signature in API reference**

In `docs/api/index.md`, update the `.use(middleware)` section to reflect the new signature:

```markdown
##### `.use(middlewareOrRouter)`

Adds global middleware that wraps all dispatches, or merges another router's handlers and middleware.

\`\`\`ts
// Middleware function
use(middleware: (ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>): this

// Another router (eager merge)
use(router: WorkflowRouter<TConfig, TDeps>): this
\`\`\`

When passed a `WorkflowRouter`, its handlers, wildcard handlers, and middleware are eagerly copied into this router. The child's definition must match (reference equality). Parent handlers take priority on conflicts.
```

- [ ] **Step 3: Commit**

```bash
git add docs/guide/routing-commands.md docs/api/index.md
git commit -m "docs: add composable routers to guide and API reference"
```

---

## Task 5: Final verification and push

- [ ] **Step 1: Run full check**

Run: `pnpm check`
Expected: All tests pass, typecheck passes, biome clean

- [ ] **Step 2: Push**

```bash
git push
```
