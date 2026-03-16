# Pre-computed Config Types Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix IDE type completion for `ctx.data`, `emit()`, `error()`, `transition()`, and `update()` by pre-computing `z.infer` types at the `defineWorkflow` call site.

**Architecture:** Add a `_resolved` phantom type to `WorkflowConfig` that caches eagerly-resolved `z.infer` results. The four utility types (`StateData`, `CommandPayload`, `EventData`, `ErrorData`) switch from conditional `z.infer` to direct indexed access into `_resolved`. `defineWorkflow` intersects the resolved types onto its return, so all downstream generics get concrete types.

**Tech Stack:** TypeScript (type-level only), Zod v4

**Spec:** `docs/superpowers/specs/2026-03-16-precomputed-config-types-design.md`

---

## Task 1: Update types and defineWorkflow

Both `types.ts` and `definition.ts` must change together — the type hierarchy and the function that populates it are co-dependent. Changing one without the other breaks typecheck.

**Files:**
- Modify: `packages/core/src/types.ts:1-46`
- Modify: `packages/core/src/definition.ts:1-87`

### types.ts changes

- [ ] **Step 1: Add `WorkflowConfigInput` and update `WorkflowConfig`**

Replace lines 1-17 of `types.ts` with:

```typescript
import type { ZodType, z } from "zod";

/**
 * Shape of the configuration object passed to {@link defineWorkflow}.
 * Exported for internal package use only — not re-exported from index.ts.
 */
export interface WorkflowConfigInput {
	/** Optional version number for schema migrations. Defaults to 1. */
	modelVersion?: number;
	/** Record of state names to Zod schemas defining their data shape. */
	states: Record<string, ZodType>;
	/** Record of command names to Zod schemas defining their payload shape. */
	commands: Record<string, ZodType>;
	/** Record of event names to Zod schemas defining their data shape. */
	events: Record<string, ZodType>;
	/** Record of error codes to Zod schemas defining their data shape. */
	errors: Record<string, ZodType>;
}

/**
 * Workflow configuration with pre-resolved types for IDE completion.
 *
 * Extends {@link WorkflowConfigInput} with a `_resolved` phantom type that
 * caches `z.infer` results. This exists because Zod v4's `z.infer` uses
 * conditional types that TypeScript defers in deep generic chains, breaking
 * IDE autocomplete. The `_resolved` property is never set at runtime — it is
 * populated at the type level by {@link defineWorkflow}'s return type.
 */
export interface WorkflowConfig extends WorkflowConfigInput {
	_resolved: {
		states: Record<string, unknown>;
		commands: Record<string, unknown>;
		events: Record<string, unknown>;
		errors: Record<string, unknown>;
	};
}
```

`WorkflowConfigInput` is exported from `types.ts` so `definition.ts` can import it, but it must NOT be added to `index.ts` — it is internal to the package.

- [ ] **Step 2: Update the four utility type bodies**

Replace lines 24-46 (the four utility types) with:

```typescript
/** Resolves the data type for a given state from pre-computed types. */
export type StateData<
	T extends WorkflowConfig,
	S extends StateNames<T>,
> = T["_resolved"]["states"][S];

/** Resolves the payload type for a given command from pre-computed types. */
export type CommandPayload<
	T extends WorkflowConfig,
	C extends CommandNames<T>,
> = T["_resolved"]["commands"][C];

/** Resolves the data type for a given event from pre-computed types. */
export type EventData<
	T extends WorkflowConfig,
	E extends EventNames<T>,
> = T["_resolved"]["events"][E];

/** Resolves the data type for a given error code from pre-computed types. */
export type ErrorData<
	T extends WorkflowConfig,
	C extends ErrorCodes<T>,
> = T["_resolved"]["errors"][C];
```

The `StateNames`, `CommandNames`, `EventNames`, `ErrorCodes` types on lines 19-22 are unchanged — they use `keyof`, not `z.infer`.

### definition.ts changes

- [ ] **Step 3: Update imports in definition.ts**

Replace line 3 of `definition.ts`:

```typescript
// BEFORE
import type { StateNames, Workflow, WorkflowConfig, WorkflowOf } from "./types.js";

// AFTER
import type {
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowConfigInput,
	WorkflowOf,
} from "./types.js";
```

Both `ZodType` and `z` on line 1 remain needed — `ZodType` for schema getter return types, `z` for `z.infer` in the new `defineWorkflow` return type.

- [ ] **Step 4: Update `createWorkflow` in the `WorkflowDefinition` interface**

Replace line 23 of `definition.ts`:

```typescript
// BEFORE
		config: { initialState: S; data: z.infer<TConfig["states"][S]> },

// AFTER
		config: { initialState: S; data: StateData<TConfig, S> },
```

- [ ] **Step 5: Update `defineWorkflow` function signature**

Replace lines 84-87 of `definition.ts`:

```typescript
// BEFORE
export function defineWorkflow<const TConfig extends WorkflowConfig>(
	name: string,
	config: TConfig,
): WorkflowDefinition<TConfig> {

// AFTER
// Zod v4 uses conditional types for z.infer which TypeScript defers in deep
// generic chains, breaking IDE completion. We pre-compute all inferred types
// at this call site (where TConfig is concrete) and attach them as _resolved,
// so downstream utility types can use direct indexed access instead.
export function defineWorkflow<const TConfig extends WorkflowConfigInput>(
	name: string,
	config: TConfig,
): WorkflowDefinition<
	TConfig & {
		_resolved: {
			states: { [K in keyof TConfig["states"]]: z.infer<TConfig["states"][K]> };
			commands: { [K in keyof TConfig["commands"]]: z.infer<TConfig["commands"][K]> };
			events: { [K in keyof TConfig["events"]]: z.infer<TConfig["events"][K]> };
			errors: { [K in keyof TConfig["errors"]]: z.infer<TConfig["errors"][K]> };
		};
	}
> {
```

The `const` modifier on `TConfig` already exists — only the constraint changes from `WorkflowConfig` to `WorkflowConfigInput`.

The implementation body is unchanged. The runtime object doesn't have `_resolved` (it's a phantom type), but the existing `as` casts inside the body handle this. If TypeScript can't prove `TConfig & { _resolved: ... }` extends `WorkflowConfig` generically, cast the entire return object:

```typescript
} as unknown as WorkflowDefinition<...>;
```

Only add this cast if `tsc --noEmit` fails without it.

### Verify and commit

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: PASS. If it fails due to the constraint satisfaction issue described above, add the type assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/definition.ts
git commit -m "refactor: pre-compute z.infer types for IDE completion

Zod v4's z.infer uses conditional types that TypeScript defers in deep
generic chains, breaking IDE autocomplete for ctx.data, emit(), error(),
transition(), and update().

Fix by eagerly resolving all z.infer types at the defineWorkflow call
site (where TConfig is concrete) and storing them in a _resolved phantom
type. Utility types now use direct indexed access into _resolved."
```

---

## Task 2: Full verification

- [ ] **Step 1: Run core tests**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: 149 tests pass (runtime is unchanged)

- [ ] **Step 2: Build core**

Run: `pnpm --filter @rytejs/core tsup`
Expected: Build succeeds

- [ ] **Step 3: Run testing package tests**

The `@rytejs/testing` package uses `TConfig extends WorkflowConfig` in `test-path.ts`, `create-test-workflow.ts`, `assertions.ts`, and `migration-testing.ts`. These constraints now implicitly require `_resolved`, which is fine — `TConfig` always flows from a `WorkflowDefinition` produced by `defineWorkflow`.

Run: `pnpm --filter @rytejs/testing vitest run`
Expected: 29 tests pass

- [ ] **Step 4: Lint**

Run: `pnpm biome check .`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes

**Default type parameters:** Types with `= WorkflowConfig` defaults (`WorkflowDefinition`, `Workflow`, `PipelineError`, `DispatchResult`, `WorkflowSnapshot`, `MigrationPipeline`) resolve `_resolved` values to `Record<string, unknown>`, so utility types produce `unknown` — same effective behavior as before.

**Breaking change surface:** Consumers who directly annotate `const config: WorkflowConfig = { ... }` would need `_resolved`. This is extremely rare — everyone uses `defineWorkflow()`. `WorkflowConfigInput` is not re-exported from `index.ts`.
