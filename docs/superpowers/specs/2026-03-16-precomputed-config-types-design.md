# Pre-computed Config Types in @rytejs/core

## Problem

IDE type completion (WebStorm, and likely VS Code to a lesser degree) fails to
resolve `data` fields throughout the router API — `ctx.data`, `emit({ data })`,
`error({ data })` all show as unresolved or `unknown` in autocomplete.

### Root Cause

Every usage site resolves types through `z.infer`, which in Zod v4 is a
**conditional type**:

```typescript
// zod/v4/core/core.d.ts
type output<T> = T extends { _zod: { output: any } } ? T["_zod"]["output"] : unknown;
```

TypeScript **defers** conditional types when the type parameter is still generic.
Since the router's type chain is deeply nested
(`TConfig` → `WorkflowRouter` → `StateBuilder` → `Context` → `emit`/`data`/`error`),
the IDE never actually resolves the conditional — it just shows the raw type
expression.

Zod v3 used direct property access (`T["_output"]`) which TypeScript could
resolve eagerly. Zod v4's switch to a conditional broke IDE inference through
deep generic chains.

### Affected API Surface

| API | Type used | Broken? |
|-----|-----------|---------|
| `ctx.data` | `StateData<T, S>` → `z.infer<T["states"][S]>` | Yes |
| `ctx.command.payload` | `CommandPayload<T, C>` → `z.infer<T["commands"][C]>` | Yes |
| `emit({ data })` | `EventData<T, E>` → `z.infer<T["events"][E]>` | Yes |
| `error({ data })` | `ErrorData<T, C>` → `z.infer<T["errors"][C]>` | Yes |
| `transition(target, data)` | `StateData<T, Target>` → `z.infer<...>` | Yes |
| `update(data)` | `Partial<StateData<T, S>>` → `Partial<z.infer<...>>` | Yes |

## Solution: Pre-computed Config Types (Option A — Separate Input Type)

### Approach

Eagerly resolve all `z.infer` types at the `defineWorkflow` call site — the one
place where `TConfig` is fully concrete — and store them in a `_resolved`
phantom type. Downstream utility types use direct indexed access into
`_resolved` instead of `z.infer`, eliminating all conditional types from the
resolution chain.

### 1. Type Hierarchy

Split the config constraint into "input" (what users pass) and "resolved" (what
flows through the system):

```typescript
// Internal only — NOT exported. Used only by defineWorkflow's parameter.
interface WorkflowConfigInput {
	modelVersion?: number;
	states: Record<string, ZodType>;
	commands: Record<string, ZodType>;
	events: Record<string, ZodType>;
	errors: Record<string, ZodType>;
}

// Exported — used in ALL downstream generics (Context, StateBuilder, etc.)
interface WorkflowConfig extends WorkflowConfigInput {
	_resolved: {
		states: Record<string, unknown>;
		commands: Record<string, unknown>;
		events: Record<string, unknown>;
		errors: Record<string, unknown>;
	};
}
```

`WorkflowConfigInput` is the current `WorkflowConfig` shape, renamed. The new
`WorkflowConfig` extends it with a required `_resolved` property. This means all
downstream types (`Context`, `WorkflowRouter`, `StateBuilder`, etc.) keep their
existing `T extends WorkflowConfig` constraints — they now implicitly require
`_resolved` to be present.

`_resolved` is never populated at runtime. It exists purely as a type-level
cache.

### 2. `defineWorkflow` Return Type

`defineWorkflow` accepts `WorkflowConfigInput` (no `_resolved`) and returns a
`WorkflowDefinition` whose `TConfig` is intersected with the resolved types:

```typescript
// Zod v4 uses conditional types for z.infer which TypeScript defers in deep
// generic chains, breaking IDE completion. We pre-compute all inferred types
// at this call site (where TConfig is concrete) and attach them as _resolved,
// so downstream utility types can use direct indexed access instead.
function defineWorkflow<const TConfig extends WorkflowConfigInput>(
	name: string,
	config: TConfig,
): WorkflowDefinition<TConfig & {
	_resolved: {
		states:   { [K in keyof TConfig["states"]]:   z.infer<TConfig["states"][K]> };
		commands: { [K in keyof TConfig["commands"]]: z.infer<TConfig["commands"][K]> };
		events:   { [K in keyof TConfig["events"]]:   z.infer<TConfig["events"][K]> };
		errors:   { [K in keyof TConfig["errors"]]:   z.infer<TConfig["errors"][K]> };
	};
}>;
```

At the call site, `TConfig` is concrete, so TypeScript eagerly resolves every
`z.infer` in the mapped types. The result flows into `WorkflowDefinition` with
`_resolved` fully materialized.

Note: the `const` modifier on `TConfig` already exists in the current code — the
only change to the generic is the constraint (`WorkflowConfigInput` instead of
`WorkflowConfig`).

**Constraint satisfaction:** The return type `TConfig & { _resolved: { ... } }`
must extend `WorkflowConfig` for `WorkflowDefinition<...>` to accept it.
`TConfig extends WorkflowConfigInput` provides `states`, `commands`, `events`,
`errors`. The intersection adds `_resolved`. Since `WorkflowConfig extends
WorkflowConfigInput`, the intersection structurally satisfies `WorkflowConfig`.
If TypeScript cannot prove this generically, a type assertion in the
implementation body is acceptable — the structural guarantee holds.

### 3. Utility Type Changes

The four data utility types change from conditional `z.infer` to direct indexed
access:

```typescript
// BEFORE — conditional type, deferred through generics:
type StateData<T extends WorkflowConfig, S extends StateNames<T>> =
	T["states"][S] extends ZodType ? z.infer<T["states"][S]> : never;

// AFTER — plain property access, resolves instantly:
type StateData<T extends WorkflowConfig, S extends StateNames<T>> =
	T["_resolved"]["states"][S];
```

Same pattern for `CommandPayload`, `EventData`, `ErrorData`. The name
extraction types (`StateNames`, `CommandNames`, `EventNames`, `ErrorCodes`) are
unchanged — they use `keyof`, not `z.infer`.

### 4. `createWorkflow` Signature

`WorkflowDefinition.createWorkflow` also uses `z.infer` directly and must be
updated:

```typescript
// BEFORE
createWorkflow<S extends StateNames<TConfig>>(
	id: string,
	config: { initialState: S; data: z.infer<TConfig["states"][S]> },
): WorkflowOf<TConfig, S>;

// AFTER
createWorkflow<S extends StateNames<TConfig>>(
	id: string,
	config: { initialState: S; data: StateData<TConfig, S> },
): WorkflowOf<TConfig, S>;
```

## Scope

### Files That Change

| File | Change |
|------|--------|
| `types.ts` | Add `WorkflowConfigInput`, add `_resolved` to `WorkflowConfig`, update 4 utility type bodies |
| `definition.ts` | Change `defineWorkflow` constraint to `WorkflowConfigInput`, add `_resolved` to return type, change `createWorkflow` to use `StateData` |

### Files That Don't Change

| File | Why |
|------|-----|
| `context.ts` | Uses `StateData`, `CommandPayload`, etc. — same API, new implementation |
| `router.ts` | `T extends WorkflowConfig` still works — `TConfig` from `WorkflowDefinition` has `_resolved` |
| `middleware.ts` | Context types flow through unchanged |
| `handler.ts` | Same |
| `readonly-context.ts` | Derived from `Context` via `Omit` |
| `plugin.ts` | `T extends WorkflowConfig` — plugins get `TConfig` from router |
| `migration.ts` | Uses `WorkflowConfig` constraint, doesn't use data utility types |
| `snapshot.ts` | Uses `StateNames` only |
| `hooks.ts` | No generic types |
| `index.ts` | No export changes (`WorkflowConfigInput` is internal) |

### Runtime

Zero runtime changes. This is purely a type-level change. The `_resolved`
property is a phantom type — never set or read at runtime.

### Consumer Impact

Zero. `defineWorkflow` still accepts the same config objects. All types flowing
downstream carry `_resolved` automatically via the intersection in
`defineWorkflow`'s return type.

### `@rytejs/testing` Downstream Impact

The testing package uses `TConfig extends WorkflowConfig` in `test-path.ts`,
`create-test-workflow.ts`, `assertions.ts`, and `migration-testing.ts`. These
constraints now implicitly require `_resolved`. This is fine — the testing
package always receives `TConfig` from a `WorkflowDefinition` produced by
`defineWorkflow`, which provides `_resolved`. No changes needed in the testing
package.

### Default Type Parameters

Several types use `= WorkflowConfig` as a default: `WorkflowDefinition`,
`Workflow`, `PipelineError`, `DispatchResult`, `WorkflowSnapshot`,
`MigrationPipeline`. With the change, the default `_resolved` values are
`Record<string, unknown>`, so utility types resolve to `unknown` — the same
effective behavior as before when `z.infer` operated on unnarrowed `ZodType`.

### Breaking Change Surface

Consumers who directly annotate `const config: WorkflowConfig = { ... }` would
need to provide `_resolved`. This pattern is extremely rare — everyone uses
`defineWorkflow()` which infers the type. `WorkflowConfigInput` is not exported,
so consumers can't reference the old shape by name.

## Verification

1. `pnpm --filter @rytejs/core tsc --noEmit` — type check passes
2. `pnpm --filter @rytejs/core vitest run` — 149 tests pass (runtime unchanged)
3. `pnpm --filter @rytejs/core tsup` — build succeeds
4. `pnpm --filter @rytejs/testing vitest run` — 29 tests pass (imports from dist)
5. `pnpm biome check .` — lint passes
6. Manual IDE verification: hover over `ctx.data`, `emit({ data })`,
   `error({ data })` to confirm autocomplete resolves concrete fields
