# State Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `defineGroup()` helper to `@rytejs/core` that produces dot-namespaced sub-states sharing a base Zod schema, with full type-safety and zero engine changes.

**Architecture:** New module `group.ts` exports a pure function `defineGroup(name, base, children)` returning a frozen value with `states` (spread into `defineWorkflow` config), `names` (passed to `router.state`), and dynamic string-literal accessors (e.g. `Payment.Pending === "Payment.Pending"`). Child schemas are merged with the base via Zod's `.merge()`. Nothing else in the engine changes.

**Tech Stack:** TypeScript 5.x (template literal types, const generics), Zod v4 (`.merge()` on `ZodObject`), Vitest 4.x, VitePress, TypeDoc (auto-generates API reference from JSDoc).

---

## File Structure

**New files:**
- `packages/core/src/group.ts` — runtime function + `StateGroup` type
- `packages/core/__tests__/group.test.ts` — runtime, integration, and type-level tests
- `docs/snippets/guide/state-groups.ts` — compilable snippet regions
- `docs/guide/state-groups.md` — guide page

**Modified files:**
- `packages/core/src/index.ts` — add exports for `defineGroup` and `StateGroup`
- `docs/.vitepress/config.ts` — add "State Groups" to Guide → Core sidebar
- `docs/guide/state-transitions.md` — short cross-reference at the end
- `docs/guide/routing-commands.md` — cross-reference where multi-state arrays are discussed (if applicable — verify during task)

**Not created:**
- Manual API reference page. TypeDoc auto-generates `docs/api/core/src.md` from JSDoc on the exported function/type. JSDoc on `defineGroup` must be thorough.

---

## Task 1: Runtime skeleton + failing test

**Files:**
- Create: `packages/core/src/group.ts`
- Create: `packages/core/__tests__/group.test.ts`

- [ ] **Step 1: Write the failing test for basic structure**

Create `packages/core/__tests__/group.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineGroup } from "../src/group.js";

describe("defineGroup()", () => {
	test("produces states record with dot-prefixed keys", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		expect(Object.keys(group.states)).toEqual(["Payment.Pending", "Payment.Failed"]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/group.test.ts`
Expected: FAIL — `Cannot find module '../src/group.js'`

- [ ] **Step 3: Create the minimal module to make it import**

Create `packages/core/src/group.ts`:

```ts
import { z } from "zod";

export function defineGroup(
	name: string,
	base: z.ZodObject,
	children: Record<string, z.ZodObject>,
) {
	const states: Record<string, z.ZodObject> = {};
	const names: string[] = [];
	const accessors: Record<string, string> = {};

	for (const [childName, childSchema] of Object.entries(children)) {
		const fullName = `${name}.${childName}`;
		states[fullName] = base.merge(childSchema);
		names.push(fullName);
		accessors[childName] = fullName;
	}

	return Object.freeze({
		name,
		states: Object.freeze(states),
		names: Object.freeze(names),
		...accessors,
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/group.test.ts`
Expected: PASS — 1 test passing

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group.ts packages/core/__tests__/group.test.ts
git commit -m "feat(core): add defineGroup() skeleton with basic state-name generation"
```

---

## Task 2: Runtime tests — names, accessors, schema validation

**Files:**
- Modify: `packages/core/__tests__/group.test.ts`

- [ ] **Step 1: Add tests for names array, accessors, and merged validation**

Append to `packages/core/__tests__/group.test.ts` inside the existing `describe("defineGroup()", ...)` block:

```ts
	test("names array contains all fully-qualified state names", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
			Retrying: z.object({ nextRetryAt: z.date() }),
		});

		expect(group.names).toEqual(["Payment.Pending", "Payment.Failed", "Payment.Retrying"]);
	});

	test("dynamic accessors return the fully-qualified name", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		// biome-ignore lint/suspicious/noExplicitAny: dynamic property access for runtime check
		expect((group as any).Pending).toBe("Payment.Pending");
		// biome-ignore lint/suspicious/noExplicitAny: dynamic property access for runtime check
		expect((group as any).Failed).toBe("Payment.Failed");
	});

	test("merged schema validates combined parent + child fields", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		const schema = group.states["Payment.Pending"];
		expect(schema.safeParse({ amount: 100, attempt: 1 }).success).toBe(true);
	});

	test("merged schema rejects data missing parent fields", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		expect(group.states["Payment.Pending"].safeParse({ attempt: 1 }).success).toBe(false);
	});

	test("merged schema rejects data missing child fields", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		expect(group.states["Payment.Pending"].safeParse({ amount: 100 }).success).toBe(false);
	});

	test("child fields override parent fields on key collision (Zod merge semantics)", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Refund: z.object({ amount: z.string() }), // child narrows amount to string
		});

		const schema = group.states["Payment.Refund"];
		expect(schema.safeParse({ amount: "full" }).success).toBe(true);
		expect(schema.safeParse({ amount: 100 }).success).toBe(false);
	});

	test("empty children record produces empty states and names", () => {
		const group = defineGroup("Empty", z.object({ x: z.number() }), {});
		expect(group.states).toEqual({});
		expect(group.names).toEqual([]);
	});

	test("group, states, and names are frozen", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		expect(Object.isFrozen(group)).toBe(true);
		expect(Object.isFrozen(group.states)).toBe(true);
		expect(Object.isFrozen(group.names)).toBe(true);
	});
```

- [ ] **Step 2: Run tests to verify they all pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/group.test.ts`
Expected: PASS — 9 tests passing (1 from Task 1, 8 new)

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/group.test.ts
git commit -m "test(core): cover defineGroup() runtime behavior — merge, collision, freeze"
```

---

## Task 3: Precise type signature

**Files:**
- Modify: `packages/core/src/group.ts`

- [ ] **Step 1: Replace the loose signature with the precise generic signature**

Replace the entire contents of `packages/core/src/group.ts` with:

```ts
import type { z } from "zod";

/**
 * A group of related sub-states that share a common base schema.
 *
 * Returned by {@link defineGroup}. Expose three things:
 *
 * 1. `states` — spread into {@link defineWorkflow}'s `states` config
 * 2. `names` — array of fully-qualified names, pass to `router.state([...])` for group-wide handlers
 * 3. Dynamic accessors (one per child) — string literals like `group.Pending === "Payment.Pending"`
 *
 * @typeParam TName - The group name prefix (e.g. `"Payment"`)
 * @typeParam TBase - The base Zod object schema shared by all sub-states
 * @typeParam TChildren - Map of child names to their Zod object schemas
 */
export type StateGroup<
	TName extends string,
	TBase extends z.ZodObject,
	TChildren extends Record<string, z.ZodObject>,
> = {
	readonly name: TName;
	readonly states: {
		[K in keyof TChildren as `${TName}.${K & string}`]: z.ZodObject<
			TBase["shape"] & TChildren[K]["shape"]
		>;
	};
	readonly names: ReadonlyArray<`${TName}.${keyof TChildren & string}`>;
} & {
	readonly [K in keyof TChildren]: `${TName}.${K & string}`;
};

/**
 * Defines a group of related sub-states sharing a base schema.
 *
 * Sub-states are addressed by dot-separated names (e.g. `"Payment.Pending"`). Each
 * sub-state's data type is `z.infer<base>` combined with `z.infer<child>` (child
 * fields win on collision, per Zod's merge semantics).
 *
 * Spread the returned `states` into `defineWorkflow`'s config; the rest of the
 * engine sees plain flat states and requires no special handling. Use `group.names`
 * with `router.state([...])` to register a handler shared across all sub-states,
 * or `group.ChildName` to target a single sub-state.
 *
 * @example
 * ```ts
 * const Payment = defineGroup("Payment", z.object({ amount: z.number() }), {
 *   Pending: z.object({ attempt: z.number() }),
 *   Failed: z.object({ reason: z.string() }),
 * });
 *
 * const definition = defineWorkflow("order", {
 *   states: { Draft: z.object({ items: z.array(z.string()) }), ...Payment.states },
 *   commands: { Retry: z.object({}), Cancel: z.object({}) },
 *   events: {},
 *   errors: {},
 * });
 *
 * const router = new WorkflowRouter(definition);
 *
 * // Group-wide handler — fires for any Payment.* state
 * router.state(Payment.names, ({ on }) => {
 *   on("Cancel", ({ transition }) => transition("Draft", { items: [] }));
 * });
 *
 * // Sub-state-specific handler — only fires in Payment.Pending
 * router.state(Payment.Pending, ({ on }) => {
 *   on("Retry", ({ data, transition }) => { ... });
 * });
 * ```
 *
 * @param name - Group name prefix (used as the first segment of each state name)
 * @param base - Zod object schema shared by all sub-states
 * @param children - Map of child names to their Zod object schemas; each is merged with `base`
 */
export function defineGroup<
	const TName extends string,
	TBase extends z.ZodObject,
	const TChildren extends Record<string, z.ZodObject>,
>(name: TName, base: TBase, children: TChildren): StateGroup<TName, TBase, TChildren> {
	const states: Record<string, z.ZodObject> = {};
	const names: string[] = [];
	const accessors: Record<string, string> = {};

	for (const [childName, childSchema] of Object.entries(children)) {
		const fullName = `${name}.${childName}`;
		states[fullName] = base.merge(childSchema);
		names.push(fullName);
		accessors[childName] = fullName;
	}

	return Object.freeze({
		name,
		states: Object.freeze(states),
		names: Object.freeze(names),
		...accessors,
	}) as unknown as StateGroup<TName, TBase, TChildren>;
}
```

- [ ] **Step 2: Run all group tests to verify they still pass with the precise signature**

Run: `pnpm --filter @rytejs/core vitest run __tests__/group.test.ts`
Expected: PASS — 9 tests passing

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/group.ts
git commit -m "feat(core): lock down defineGroup() types with precise generics"
```

---

## Task 4: Type-level tests using `expectTypeOf`

Vitest ships `expectTypeOf` from `vitest`. Since there is no existing `.test-d.ts` convention in this repo, type assertions live inline in the same test file.

**Files:**
- Modify: `packages/core/__tests__/group.test.ts`

- [ ] **Step 1: Add type-level tests**

Append to `packages/core/__tests__/group.test.ts`:

```ts
import { expectTypeOf } from "vitest";

describe("defineGroup() types", () => {
	test("accessors are string-literal types, not widened to string", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		expectTypeOf(group.Pending).toEqualTypeOf<"Payment.Pending">();
		expectTypeOf(group.Failed).toEqualTypeOf<"Payment.Failed">();
	});

	test("names is a readonly array of the union of sub-state names", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		expectTypeOf(group.names).toEqualTypeOf<
			ReadonlyArray<"Payment.Pending" | "Payment.Failed">
		>();
	});

	test("states record keys are the fully-qualified names", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		type Keys = keyof typeof group.states;
		expectTypeOf<Keys>().toEqualTypeOf<"Payment.Pending">();
	});

	test("each state schema infers to the merged shape", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		type Inferred = z.infer<(typeof group.states)["Payment.Pending"]>;
		expectTypeOf<Inferred>().toEqualTypeOf<{ amount: number; attempt: number }>();
	});
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @rytejs/core vitest run __tests__/group.test.ts`
Expected: PASS — 13 tests passing (9 runtime + 4 type)

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/group.test.ts
git commit -m "test(core): add type-level assertions for defineGroup() inference"
```

---

## Task 5: Integration tests — spread into defineWorkflow + router

**Files:**
- Modify: `packages/core/__tests__/group.test.ts`

- [ ] **Step 1: Add integration tests exercising the full engine path**

Append to `packages/core/__tests__/group.test.ts`:

```ts
import { defineWorkflow } from "../src/definition.js";
import { WorkflowRouter } from "../src/router.js";

describe("defineGroup() integration with defineWorkflow + WorkflowRouter", () => {
	function buildOrderWorkflow() {
		const Payment = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
			Retrying: z.object({ attempt: z.number(), nextRetryAt: z.date() }),
		});

		const definition = defineWorkflow("order", {
			states: {
				Draft: z.object({ items: z.array(z.string()) }),
				...Payment.states,
				Shipped: z.object({ trackingId: z.string() }),
			},
			commands: {
				StartPayment: z.object({ amount: z.number() }),
				RetryPayment: z.object({}),
				CancelPayment: z.object({}),
				FailPayment: z.object({ reason: z.string() }),
			},
			events: {},
			errors: {},
		});

		return { Payment, definition };
	}

	test("spreading group.states into definition registers all sub-states", () => {
		const { definition } = buildOrderWorkflow();
		expect(definition.hasState("Payment.Pending")).toBe(true);
		expect(definition.hasState("Payment.Failed")).toBe(true);
		expect(definition.hasState("Payment.Retrying")).toBe(true);
		expect(definition.hasState("Draft")).toBe(true);
		expect(definition.hasState("Shipped")).toBe(true);
	});

	test("createWorkflow accepts a sub-state as initial state with merged data", () => {
		const { definition } = buildOrderWorkflow();
		const wf = definition.createWorkflow("order-1", {
			initialState: "Payment.Pending",
			data: { amount: 100, attempt: 1 },
		});
		expect(wf.state).toBe("Payment.Pending");
		expect(wf.data).toEqual({ amount: 100, attempt: 1 });
	});

	test("handler on a specific sub-state fires for that sub-state", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);

		router.state(Payment.Pending, ({ on }) => {
			on("RetryPayment", ({ data, transition }) => {
				transition("Payment.Retrying", {
					amount: data.amount,
					attempt: data.attempt + 1,
					nextRetryAt: new Date("2026-01-01T00:00:00Z"),
				});
			});
		});

		const wf = definition.createWorkflow("w1", {
			initialState: "Payment.Pending",
			data: { amount: 100, attempt: 1 },
		});

		const result = await router.dispatch(wf, "RetryPayment", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.state).toBe("Payment.Retrying");
		}
	});

	test("handler on group.names fires for every sub-state in the group", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);
		const seen: string[] = [];

		router.state(Payment.names, ({ on }) => {
			on("CancelPayment", ({ workflow, transition }) => {
				seen.push(workflow.state);
				transition("Draft", { items: [] });
			});
		});

		for (const [initialState, data] of [
			["Payment.Pending", { amount: 100, attempt: 1 }],
			["Payment.Failed", { amount: 100, reason: "declined" }],
			["Payment.Retrying", { amount: 100, attempt: 2, nextRetryAt: new Date() }],
		] as const) {
			const wf = definition.createWorkflow("w", { initialState, data });
			const result = await router.dispatch(wf, "CancelPayment", {});
			expect(result.ok).toBe(true);
		}

		expect(seen).toEqual(["Payment.Pending", "Payment.Failed", "Payment.Retrying"]);
	});

	test("sub-state-specific handler wins over group-wide handler", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);
		const tag: string[] = [];

		router.state(Payment.names, ({ on }) => {
			on("CancelPayment", ({ transition }) => {
				tag.push("group");
				transition("Draft", { items: [] });
			});
		});

		router.state(Payment.Pending, ({ on }) => {
			on("CancelPayment", ({ transition }) => {
				tag.push("specific");
				transition("Draft", { items: [] });
			});
		});

		const wf = definition.createWorkflow("w", {
			initialState: "Payment.Pending",
			data: { amount: 100, attempt: 1 },
		});
		await router.dispatch(wf, "CancelPayment", {});
		expect(tag).toEqual(["specific"]);
	});

	test("transition to a sub-state validates against the merged schema", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);

		router.state("Draft", ({ on }) => {
			on("StartPayment", ({ command, transition }) => {
				// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid data to test validation
				transition("Payment.Pending", { amount: command.payload.amount } as any);
			});
		});

		const wf = definition.createWorkflow("w", {
			initialState: "Draft",
			data: { items: ["book"] },
		});

		const result = await router.dispatch(wf, "StartPayment", { amount: 100 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("validation");
			if (result.error.category === "validation") {
				expect(result.error.source).toBe("transition");
			}
		}
	});

	test("snapshot and deserialize round-trip a sub-state correctly", () => {
		const { definition } = buildOrderWorkflow();
		const wf = definition.createWorkflow("order-1", {
			initialState: "Payment.Retrying",
			data: { amount: 50, attempt: 3, nextRetryAt: new Date("2026-01-01T00:00:00Z") },
		});

		const snapshot = definition.serialize(wf);
		expect(snapshot.state).toBe("Payment.Retrying");

		const restored = definition.deserialize(snapshot);
		expect(restored.ok).toBe(true);
		if (restored.ok) {
			expect(restored.workflow.state).toBe("Payment.Retrying");
			expect(restored.workflow.data).toMatchObject({ amount: 50, attempt: 3 });
		}
	});
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @rytejs/core vitest run __tests__/group.test.ts`
Expected: PASS — 20 tests passing (13 existing + 7 integration)

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/group.test.ts
git commit -m "test(core): integration tests for defineGroup() with router + snapshots"
```

---

## Task 6: Export from index

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the exports alphabetically among the existing entries**

Insert into `packages/core/src/index.ts` in alphabetical position (after `definePlugin`, before `DomainErrorSignal`):

```ts
export { defineGroup } from "./group.js";
export type { StateGroup } from "./group.js";
```

The full relevant section should look like:

```ts
export { createKey } from "./key.js";
export type { Middleware } from "./middleware.js";
export type {
	MigrateOptions,
	MigrateResult,
	MigrationEntry,
	MigrationFn,
	MigrationPipeline,
} from "./migration.js";
export { defineMigrations, MigrationError, migrate } from "./migration.js";
export type { GenericPlugin, Plugin } from "./plugin.js";
export { defineGenericPlugin, definePlugin, isPlugin } from "./plugin.js";
export { defineGroup } from "./group.js";
export type { StateGroup } from "./group.js";
export type { ReadonlyContext } from "./readonly-context.js";
```

- [ ] **Step 2: Run biome to auto-sort imports/exports**

Run: `pnpm biome check --fix packages/core/src/index.ts`
Expected: 0 errors (biome may reorder the lines into its preferred position — this is fine)

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Run the full core test suite to confirm nothing else broke**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: 149 existing tests still passing + 20 new group tests = 169 passing

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export defineGroup and StateGroup type"
```

---

## Task 7: Rebuild dist and verify downstream compiles

Per CLAUDE.md: `@rytejs/testing` imports from dist, not source. Rebuild before validating.

**Files:**
- None (build artifact only)

- [ ] **Step 1: Rebuild core dist**

Run: `pnpm --filter @rytejs/core tsup`
Expected: dist files regenerated, exit code 0

- [ ] **Step 2: Verify @rytejs/testing still compiles**

Run: `pnpm --filter @rytejs/testing tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Run @rytejs/testing tests as a smoke check**

Run: `pnpm --filter @rytejs/testing vitest run`
Expected: 29 tests passing

- [ ] **Step 4: Nothing to commit (dist is gitignored). Push what we have so far**

Run: `git push`
Expected: push succeeds

---

## Task 8: Docs snippet file

**Files:**
- Create: `docs/snippets/guide/state-groups.ts`

- [ ] **Step 1: Create the snippet file**

Create `docs/snippets/guide/state-groups.ts`:

```ts
import { defineGroup, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { z } from "zod";

// #region define-group
const Payment = defineGroup("Payment", z.object({ amount: z.number(), currency: z.string() }), {
	Pending: z.object({ attempt: z.number() }),
	Failed: z.object({ reason: z.string() }),
	Retrying: z.object({ attempt: z.number(), nextRetryAt: z.date() }),
});
// #endregion define-group

// #region spread-into-config
const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		...Payment.states,
		Shipped: z.object({ trackingId: z.string() }),
	},
	commands: {
		RetryPayment: z.object({}),
		CancelPayment: z.object({}),
		FailPayment: z.object({ reason: z.string() }),
	},
	events: {},
	errors: {},
});
// #endregion spread-into-config

const router = new WorkflowRouter(orderWorkflow);

// #region sub-state-handler
router.state(Payment.Pending, ({ on }) => {
	on("RetryPayment", ({ data, transition }) => {
		// data: { amount: number, currency: string, attempt: number }
		transition("Payment.Retrying", {
			amount: data.amount,
			currency: data.currency,
			attempt: data.attempt + 1,
			nextRetryAt: new Date(Date.now() + 60_000),
		});
	});
});
// #endregion sub-state-handler

// #region group-handler
router.state(Payment.names, ({ on }) => {
	on("CancelPayment", ({ data, match, transition }) => {
		// data shared fields are accessible directly: data.amount, data.currency
		// child-specific fields require match() to narrow:
		const reason = match({
			"Payment.Pending": (d) => `cancel at attempt ${d.attempt}`,
			"Payment.Failed": (d) => `cancel after failure: ${d.reason}`,
			"Payment.Retrying": (d) => `cancel retry at attempt ${d.attempt}`,
		});
		console.log(`Cancelled ${data.amount} ${data.currency}: ${reason}`);
		transition("Draft", { items: [] });
	});
});
// #endregion group-handler
```

- [ ] **Step 2: Typecheck the snippets**

Run: `pnpm --filter @rytejs/docs typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add docs/snippets/guide/state-groups.ts
git commit -m "docs: add state-groups snippet file for guide page"
```

---

## Task 9: Guide page

**Files:**
- Create: `docs/guide/state-groups.md`

- [ ] **Step 1: Create the guide page**

Create `docs/guide/state-groups.md`:

````markdown
# State Groups

State groups let you define a set of related sub-states that share a common base schema, addressed by dot-separated names like `"Payment.Pending"` and `"Payment.Failed"`.

They solve three concrete problems:

- **State-name explosion** — keep the top-level state list readable
- **Shared handlers** — one handler for every `Payment.*` sub-state
- **Shared data** — parent fields automatically on every sub-state, child fields extend them

Groups are a pure schema helper. The engine sees flat states after the group is spread into the config; nothing about dispatch, snapshots, or migrations changes.

## Defining a Group

`defineGroup(name, base, children)` takes a prefix, a base `z.object()` schema, and a record of child schemas. Each child's schema is merged with the base.

<<< @/snippets/guide/state-groups.ts#define-group

The returned value exposes:

- `states` — spread into `defineWorkflow`'s `states` config
- `names` — an array of fully-qualified names (`["Payment.Pending", "Payment.Failed", ...]`)
- Dynamic string-literal accessors — `Payment.Pending === "Payment.Pending"`

## Spreading into a Workflow

<<< @/snippets/guide/state-groups.ts#spread-into-config

After the spread, `"Payment.Pending"`, `"Payment.Failed"`, and `"Payment.Retrying"` are first-class states alongside `"Draft"` and `"Shipped"`. `StateNames<TConfig>` includes them all.

## Handlers on a Specific Sub-State

Pass the string-literal accessor (e.g. `Payment.Pending`) to `router.state()`. Inside the handler, `ctx.data` has the full merged type — base fields plus child-specific fields.

<<< @/snippets/guide/state-groups.ts#sub-state-handler

## Handlers on the Whole Group

Pass `group.names` to `router.state()` to register a handler that fires in every sub-state. Inside the handler, `ctx.data` is the union of all sub-state data types — shared fields (from the base) are directly accessible, but child-specific fields require `ctx.match()` to narrow.

<<< @/snippets/guide/state-groups.ts#group-handler

Sub-state-specific handlers take priority over group-wide handlers. If a command matches both, only the sub-state-specific one runs.

## Transitioning

Transitions work exactly as they do for flat states. `transition("Payment.Failed", data)` validates `data` against the merged schema — both base and child fields are required.

## When NOT to Use Groups

- **No shared base fields** — just use flat states. Groups only pay off when the base carries meaningful data.
- **Non-object schemas** — `defineGroup` requires `z.object()` for both base and children. If you need `z.union`, `z.string`, or similar, register the states flatly under dot-separated names.
- **Full statechart semantics** — Ryte doesn't support entry/exit actions, history pseudo-states, or automatic parent-handler fallthrough on missed commands. Groups are a naming-and-schema mechanism, not a hierarchical state machine.

## Limitations

- Base and children must be `z.ZodObject` (i.e. `z.object({...})`)
- Groups are flat — a child cannot itself be a group
- On key collision, Zod's merge resolves child-wins (child schema overrides parent field type)
- Spreading into `states` follows JS object-spread semantics — a later key overwrites an earlier one silently
````

- [ ] **Step 2: Verify markdown builds (quick smoke check)**

Run: `pnpm --filter @rytejs/docs typecheck`
Expected: 0 errors (typecheck validates the referenced snippet regions resolve)

- [ ] **Step 3: Commit**

```bash
git add docs/guide/state-groups.md
git commit -m "docs: add State Groups guide page"
```

---

## Task 10: Sidebar + cross-references

**Files:**
- Modify: `docs/.vitepress/config.ts`
- Modify: `docs/guide/state-transitions.md`

- [ ] **Step 1: Add sidebar entry**

In `docs/.vitepress/config.ts`, inside the "Core" sidebar section (between "State Transitions" and "Architecture Patterns"), add:

```ts
{ text: "State Groups", link: "/guide/state-groups" },
```

The block should read:

```ts
{
	text: "Core",
	items: [
		{ text: "Defining Workflows", link: "/guide/defining-workflows" },
		{ text: "Routing Commands", link: "/guide/routing-commands" },
		{ text: "State Transitions", link: "/guide/state-transitions" },
		{ text: "State Groups", link: "/guide/state-groups" },
		{ text: "Architecture Patterns", link: "/guide/architecture" },
	],
},
```

- [ ] **Step 2: Add cross-reference at the end of state-transitions.md**

Append to `docs/guide/state-transitions.md`:

```markdown

## See Also

- [State Groups](./state-groups.md) — for defining related sub-states that share a base schema and handlers
```

- [ ] **Step 3: Verify docs typecheck**

Run: `pnpm --filter @rytejs/docs typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add docs/.vitepress/config.ts docs/guide/state-transitions.md
git commit -m "docs: link State Groups from sidebar and state-transitions page"
```

---

## Task 11: Full workspace check + final push

**Files:**
- None

- [ ] **Step 1: Run the full workspace check**

Run: `pnpm run check`
Expected: 0 errors across typecheck, tests, lint

- [ ] **Step 2: Push all commits**

Run: `git push`
Expected: push succeeds

---

## Self-Review

Checked against the spec.

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `packages/core/src/group.ts` runtime + types | Tasks 1, 3 |
| Signature, return-type shape | Task 3 |
| Exports from `index.ts` | Task 6 |
| Integration verified (defineWorkflow, router, transitions, snapshots) | Task 5 |
| Runtime tests (keys, names, accessors, validation, collision, empty, freeze) | Tasks 1, 2 |
| Type-level assertions (string literals, union names, merged shape) | Task 4 |
| Guide page | Task 9 |
| Snippet file with regions | Task 8 |
| Sidebar entry | Task 10 |
| Cross-reference in existing docs | Task 10 |
| Rebuild dist + verify `@rytejs/testing` compiles | Task 7 |
| `pnpm run check` clean | Task 11 |

**Adjustments from spec:**

- Spec mentioned a manual `docs/api/define-group.md` page. The actual repo uses TypeDoc to auto-generate `docs/api/core/src.md`, so no manual API page is needed. JSDoc on `defineGroup` and `StateGroup` (Task 3) covers this — it will flow into the generated reference on the next `docs:api` run.
- Spec mentioned a cross-reference in `docs/guide/routing-commands.md` "if applicable." Dropped — the routing-commands page does not currently feature multi-state arrays prominently enough to warrant a callout; adding one would be noise. Keeping the state-transitions cross-reference which is the natural entry point.
- Test path in the spec was `packages/core/src/__tests__/group.test.ts`. Actual repo convention is `packages/core/__tests__/group.test.ts` (sibling of `src/`, not nested inside it). Plan uses the correct path.

**Placeholder scan:** No TBDs, TODOs, or unspecified steps. All code is concrete.

**Type consistency:** `defineGroup`, `StateGroup<TName, TBase, TChildren>`, `z.ZodObject`, `group.states`, `group.names`, accessor property syntax used consistently across Tasks 1, 3, 4, 5, 8, 9.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-04-15-state-groups.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
