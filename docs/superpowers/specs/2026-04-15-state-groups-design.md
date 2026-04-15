# State Groups

**Date:** 2026-04-15
**Status:** Draft

## Overview

Add a `defineGroup()` helper that lets consumers define a set of related sub-states sharing a common base schema, addressable under a dot-separated naming convention (e.g. `"Payment.Pending"`, `"Payment.Failed"`). The helper produces a value that spreads into `defineWorkflow`'s `states` record and exposes typed string-literal accessors plus a `names` array usable with the existing router API.

The feature solves three concrete pain points:

1. **State-name explosion** — grouping `Payment.*` sub-states keeps the top-level state list readable.
2. **Shared handlers** — registering a single handler for all `Payment.*` sub-states via `router.state(Payment.names, ...)`.
3. **Shared data** — every sub-state automatically carries the base schema's fields, with child-specific fields extending them.

The engine itself is not modified. `defineWorkflow`, `WorkflowRouter`, `Context`, snapshots, migrations, and every other subsystem stay untouched. `defineGroup` is a pure schema/name helper whose output is consumed by the existing APIs.

## Non-goals

- **Full statechart semantics.** No entry/exit actions, no history pseudo-states, no automatic parent-handler fallthrough on missed child commands.
- **Nested groups.** A group's children cannot themselves be groups. Flat groups only.
- **Non-object sub-states.** Base and children must be `z.ZodObject`. Consumers who need `z.union` or `z.string` sub-states can still use the dot-string convention manually.
- **Changes to `WorkflowConfig` shape.** The config's `states` remains `Record<string, ZodType>`. Groups spread into it as ordinary flat entries.

## Deliverables

### 1. New module: `packages/core/src/group.ts`

Exports `defineGroup` plus the `StateGroup` type. No runtime dependencies beyond Zod.

**Runtime (~20 lines):**

```ts
export function defineGroup(name, base, children) {
	const states = {};
	const names = [];
	const accessors = {};

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

**Signature:**

```ts
export function defineGroup<
	const TName extends string,
	TBase extends z.ZodObject,
	const TChildren extends Record<string, z.ZodObject>,
>(
	name: TName,
	base: TBase,
	children: TChildren,
): StateGroup<TName, TBase, TChildren>;
```

**Return type:**

```ts
export type StateGroup<
	TName extends string,
	TBase extends z.ZodObject,
	TChildren extends Record<string, z.ZodObject>,
> = {
	readonly name: TName;
	readonly states: {
		[K in keyof TChildren as `${TName}.${K & string}`]: MergedSchema<TBase, TChildren[K]>;
	};
	readonly names: ReadonlyArray<`${TName}.${keyof TChildren & string}`>;
} & {
	readonly [K in keyof TChildren]: `${TName}.${K & string}`;
};
```

`MergedSchema<TBase, TChild>` resolves to a `ZodObject` whose shape is `TBase["shape"] & TChild["shape"]`. `z.infer<merged>` produces the merged data type consumers see in `ctx.data`.

**Behavior notes:**

- `Object.freeze` on the outer object, `states`, and `names`. Groups are value types.
- Empty children record is legal — produces empty `states` and `names`.
- No caching beyond what the consumer gets from calling `defineGroup` at module load.
- Child names containing dots produce further-dotted names (e.g. `Payment.A.B`). Not blocked; documented recommendation is to avoid.
- Name collisions when spreading into `defineWorkflow` config follow standard JS spread semantics (later key wins). Not policed; documented.

### 2. Public API surface

Add to `packages/core/src/index.ts`:

```ts
export { defineGroup } from "./group.js";
export type { StateGroup } from "./group.js";
```

`MergedSchema` is an internal helper — not exported.

### 3. Integration with existing engine

Verified zero engine changes required. Specifically:

- **`defineWorkflow`** sees a flat `states` record after spread — no changes to `WorkflowConfigInput`, no changes to `_resolved` phantom typing, no changes to `StateNames` extraction.
- **`router.state(group.names, ...)`** uses the existing `readonly StateNames<TConfig>[]` overload. `TState` infers to the union of sub-state names; handler `ctx.data` is the union of merged types (shared fields accessible, child-specific fields available via `ctx.match`).
- **`router.state(group.ChildName, ...)`** uses the existing single-state overload. `TState` narrows to the single sub-state; `ctx.data` is the full merged type.
- **`ctx.transition(group.ChildName, data)`** uses the existing generic `Target extends StateNames<TConfig>`. Data is validated against the merged schema.
- **Snapshots** store `state: "Payment.Pending"` as a plain string. Deserialization validates against the registered schema like any other state.
- **Migrations** — no interaction. Groups operate on schemas, migrations operate on snapshot data transforms. A migration that moves a workflow into a sub-state sets `snapshot.state = "Payment.Pending"` as any string.

### 4. Tests

All tests in `packages/core/src/__tests__/group.test.ts` (new file). Run via `pnpm --filter @rytejs/core vitest run`.

**Runtime tests:**

- `defineGroup` produces `states` record with dot-prefixed keys matching children
- `names` array contains all fully-qualified state names
- Dynamic child accessors return the correct string-literal name
- Merged schemas validate data combining parent + child fields
- Merged schemas reject data missing parent fields
- Merged schemas reject data missing child fields
- Child fields override parent fields when keys collide (Zod's documented merge semantics)
- Empty children record produces empty `states` and `names`
- `Object.freeze` prevents mutation of the group, its `states`, and its `names`

**Integration tests** (using `defineWorkflow` + `WorkflowRouter` + `@rytejs/testing` helpers):

- Spread `group.states` into config — workflow definition accepts it, `StateNames` includes all sub-state names
- Create workflow in a sub-state — data validates against merged schema
- Dispatch command registered via `router.state(group.Pending, ...)` — handler fires
- Dispatch command registered via `router.state(group.names, ...)` — handler fires for every sub-state
- Sub-state-specific handler wins over group-wide handler (existing single vs. multi priority, verify groups don't break it)
- `ctx.transition("Payment.Failed", data)` validates against merged schema
- Snapshot/restore round-trips a sub-state correctly (smoke test)
- `ctx.match({ "Payment.Pending": ..., "Payment.Failed": ..., ... })` narrows data correctly

**Type-level assertions** using `expectTypeOf` inline within the same test file (check existing repo convention first; fall back to inline `expectTypeOf` if no `.test-d.ts` pattern is established):

- `Payment.Pending` has type `"Payment.Pending"` (string literal, not `string`)
- `Payment.names` is `ReadonlyArray<"Payment.Pending" | "Payment.Failed" | "Payment.Retrying">`
- `StateData<TConfig, "Payment.Pending">` equals the merged inferred type
- `router.state(Payment.Pending, ({ on }) => on("X", ({ data }) => ...))` narrows `data` to the merged type
- `router.state(Payment.names, ({ on }) => on("X", ({ data }) => ...))` gives union-typed `data` with shared fields accessible and child-specific fields unavailable without `match`
- Non-member state literals rejected (`router.state("Payment.DoesNotExist", ...)` fails to compile)

### 5. Guide page: `docs/guide/state-groups.md`

Placed in the Guide sidebar after the core state/transition pages.

**Sections:**

- **When to reach for groups** — state-name explosion, shared data, shared handlers. 2-3 paragraphs with a concrete example of the "before" (flat explosion) and the "after" (grouped).
- **Basic usage** — define base, define children, spread into config. Full `Payment` example walking from `defineGroup` call through definition registration.
- **Handler patterns** — sub-state specific vs. group-wide handlers, with explicit callouts of what `ctx.data` looks like in each. Includes `ctx.match` narrowing example.
- **Transitioning within and across groups** — shows `transition("Payment.Retrying", ...)` validating merged data.
- **When NOT to use groups** — no shared base fields (use flat states), need non-object schemas (use dot-string convention), need full statechart semantics (not supported).
- **Limitations** — base and children must be `z.ZodObject`, flat groups only, merge resolves child-wins on overlapping keys.

### 6. Snippet files: `docs/snippets/state-groups/`

Per CLAUDE.md: compilable TypeScript files with `#region` markers, tab indentation. Each region referenced from the guide via `<<< @/snippets/state-groups/<file>.ts#region`. Validated by `pnpm --filter @rytejs/docs typecheck`.

Planned snippets:

- `basic-group.ts` — `#define` region: define a group and spread into config
- `sub-state-handler.ts` — `#handler` region: handler on a specific sub-state showing full `ctx.data` type
- `group-handler.ts` — `#handler` region: handler on `group.names` using `match()` to narrow
- `cross-group-transition.ts` — `#transition` region: transition between sub-states in the same group

### 7. API reference page: `docs/api/define-group.md`

Follows the structure of existing API pages (`define-workflow.md`, `workflow-router.md` — mirror whichever convention the repo already uses). Content: signature, parameter docs, return-type shape, one compact snippet pulled from `basic-group.ts`.

### 8. Sidebar update: `docs/.vitepress/config.ts`

- Add "State Groups" to the Guide sidebar, positioned after the existing state/transition content
- Add "defineGroup" to the API sidebar alongside the other top-level exports

### 9. Cross-references in existing docs

- `docs/guide/states.md` — short "See also: State Groups" at the end
- Any guide or FAQ that currently recommends multi-state arrays (`state([...], ...)`) as the pattern for shared handlers — add a note pointing to groups as the preferred alternative when the states also share data

## What changes, what doesn't

**Changes:**

- New file `packages/core/src/group.ts` (~20 lines runtime + ~30 lines types)
- New export in `packages/core/src/index.ts`
- New test file `packages/core/src/__tests__/group.test.ts`
- New guide page, API page, snippet directory
- Sidebar entries in VitePress config
- Cross-references in one or two existing guide pages

**Does not change:**

- `WorkflowConfig` / `WorkflowConfigInput` shape
- `defineWorkflow` signature, return type, or internals
- `WorkflowRouter` API or dispatch flow
- `Context` interface or behavior
- Snapshot shape, serialization, or deserialization
- Migration pipeline
- `@rytejs/testing` package
- Any existing test

## Rollout

Additive feature. No breaking changes. Release in the next minor version of `@rytejs/core`.

After merging:

1. Rebuild core dist (`cd packages/core && npx tsup`)
2. Verify `@rytejs/testing` still compiles against the new dist
3. Run `pnpm --filter @rytejs/docs typecheck` to validate new snippets
4. Run `pnpm run check` at workspace root

## Open questions

None at spec time. The design was validated section-by-section against the existing engine before writing.
