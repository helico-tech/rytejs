# TypeDoc API Documentation Generation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-written API docs with auto-generated TypeDoc output, making source JSDoc the single source of truth.

**Architecture:** TypeDoc reads `@param`/`@returns`-enriched JSDoc from source, generates Markdown via typedoc-plugin-markdown into `docs/api/`. Turbo orchestrates: packages build → TypeDoc generates → VitePress builds. `treatWarningsAsErrors` catches JSDoc drift in CI.

**Tech Stack:** TypeDoc ^0.27, typedoc-plugin-markdown ^4, VitePress, Turbo, pnpm

**Spec:** `docs/superpowers/specs/2026-03-15-typedoc-api-generation-design.md`

---

## Chunk 1: Infrastructure Setup

### Task 1: Install TypeDoc dependencies and configure

**Files:**
- Modify: `docs/package.json`
- Create: `docs/typedoc.json`

- [ ] **Step 1: Install typedoc and typedoc-plugin-markdown**

```bash
cd /home/ralph/ryte/docs && pnpm add -D typedoc@^0.27 typedoc-plugin-markdown@^4
```

- [ ] **Step 2: Add docs:api script to docs/package.json**

In `docs/package.json`, add to `"scripts"`:

```json
"docs:api": "typedoc"
```

- [ ] **Step 3: Create docs/typedoc.json**

```json
{
  "$schema": "https://typedoc-plugin-markdown.org/schema.json",
  "entryPointStrategy": "packages",
  "entryPoints": ["../packages/core", "../packages/testing"],
  "out": "./api",
  "plugin": ["typedoc-plugin-markdown"],
  "hidePageHeader": true,
  "hideBreadcrumbs": true,
  "treatWarningsAsErrors": true
}
```

- [ ] **Step 4: Build packages and run TypeDoc to validate output structure**

```bash
cd /home/ralph/ryte && pnpm build
cd /home/ralph/ryte/docs && pnpm docs:api
```

Inspect the generated `docs/api/` directory structure. We need to know:
- What files are generated? (flat files like `core.md` or directories like `core/index.md`?)
- Is there an `api/index.md`?

Record the actual file paths — the VitePress sidebar (Task 6) depends on this.

**If TypeDoc produces directories** (e.g., `api/core/README.md` and `api/testing/README.md`), adjust `typedoc.json` options to flatten output. Try adding `"outputFileStrategy": "modules"` or `"mergeReadme": true`. Re-run until we get a structure that works as one page per package.

- [ ] **Step 5: Commit infrastructure setup**

```bash
git add docs/package.json docs/typedoc.json pnpm-lock.yaml
git commit -m "chore: add typedoc and typedoc-plugin-markdown to docs"
```

Note: Do NOT commit generated `docs/api/` files — they'll be gitignored in Task 5.

---

### Task 2: Configure turbo pipeline

**Files:**
- Modify: `turbo.json`

- [ ] **Step 1: Add docs#docs:api and docs#build tasks to turbo.json**

In `turbo.json`, add two scoped tasks to the `"tasks"` object:

```json
"docs#docs:api": {
  "dependsOn": ["^build"],
  "outputs": ["api/**"]
},
"docs#build": {
  "dependsOn": ["docs#docs:api"],
  "outputs": [".vitepress/dist/**"]
}
```

This ensures: packages build first → TypeDoc generates API docs → VitePress builds the site.

- [ ] **Step 2: Verify the pipeline works end-to-end**

```bash
cd /home/ralph/ryte && pnpm turbo run docs:api
```

Expected: turbo builds `@rytejs/core` and `@rytejs/testing` first (due to `^build`), then runs `typedoc` in docs.

- [ ] **Step 3: Commit**

```bash
git add turbo.json
git commit -m "chore: add docs:api to turbo pipeline with package build deps"
```

---

## Chunk 2: JSDoc Enrichment — @rytejs/core

### Task 3: Enrich JSDoc in packages/core/src/types.ts

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add JSDoc to all exported types and classes**

```ts
/** Shape of the configuration object passed to {@link defineWorkflow}. */
export interface WorkflowConfig {
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

/** Extracts state name strings from a workflow config. */
export type StateNames<T extends WorkflowConfig> = keyof T["states"] & string;
/** Extracts command name strings from a workflow config. */
export type CommandNames<T extends WorkflowConfig> = keyof T["commands"] & string;
/** Extracts event name strings from a workflow config. */
export type EventNames<T extends WorkflowConfig> = keyof T["events"] & string;
/** Extracts error code strings from a workflow config. */
export type ErrorCodes<T extends WorkflowConfig> = keyof T["errors"] & string;

/** Infers the data type for a given state. */
export type StateData<...> = ...;
/** Infers the payload type for a given command. */
export type CommandPayload<...> = ...;
/** Infers the data type for a given event. */
export type EventData<...> = ...;
/** Infers the data type for a given error code. */
export type ErrorData<...> = ...;

/** Workflow narrowed to a specific known state. */
export interface WorkflowOf<TConfig extends WorkflowConfig, S extends StateNames<TConfig>> {
	/** Unique workflow instance identifier. */
	readonly id: string;
	/** Name of the workflow definition this instance belongs to. */
	readonly definitionName: string;
	/** Current state name. */
	readonly state: S;
	/** State data, typed according to the state's Zod schema. */
	readonly data: StateData<TConfig, S>;
	/** Timestamp of workflow creation. */
	readonly createdAt: Date;
	/** Timestamp of last state change. */
	readonly updatedAt: Date;
}

/** Discriminated union of all possible workflow states — checking `.state` narrows `.data`. */
export type Workflow<...> = ...;

// PipelineError, DispatchResult keep existing JSDoc (already have comments)

/**
 * Thrown internally when Zod validation fails during dispatch.
 * Caught by the router and returned as a validation error in {@link DispatchResult}.
 *
 * @param source - Which validation stage failed (`"command"`, `"state"`, `"event"`, `"transition"`, or `"restore"`)
 * @param issues - Array of Zod validation issues
 */
export class ValidationError extends Error { ... }

/**
 * Thrown internally when a handler calls `ctx.error()`.
 * Caught by the router and returned as a domain error in {@link DispatchResult}.
 *
 * @param code - The error code string
 * @param data - The error data payload
 */
export class DomainErrorSignal extends Error { ... }
```

- [ ] **Step 2: Run typecheck to verify no JSDoc broke anything**

```bash
cd /home/ralph/ryte/packages/core && pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "docs: enrich JSDoc in core/types.ts with param tags and descriptions"
```

---

### Task 4: Enrich JSDoc in packages/core/src/definition.ts

**Files:**
- Modify: `packages/core/src/definition.ts`

- [ ] **Step 1: Add JSDoc to WorkflowDefinition interface and defineWorkflow function**

```ts
/**
 * The result of {@link defineWorkflow} — holds schemas and creates workflow instances.
 */
export interface WorkflowDefinition<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** The raw Zod schema configuration. */
	readonly config: TConfig;
	/** The workflow definition name. */
	readonly name: string;
	/**
	 * Creates a new workflow instance in the given initial state.
	 *
	 * @param id - Unique workflow instance identifier
	 * @param config - Initial state and data configuration
	 * @returns A new workflow narrowed to the initial state
	 */
	createWorkflow<S extends StateNames<TConfig>>(
		id: string,
		config: { initialState: S; data: z.infer<TConfig["states"][S]> },
	): WorkflowOf<TConfig, S>;
	/**
	 * Returns the Zod schema for a given state name.
	 * @param stateName - State to look up
	 * @throws If the state name is not defined
	 */
	getStateSchema(stateName: string): ZodType;
	/**
	 * Returns the Zod schema for a given command name.
	 * @param commandName - Command to look up
	 * @throws If the command name is not defined
	 */
	getCommandSchema(commandName: string): ZodType;
	/**
	 * Returns the Zod schema for a given event name.
	 * @param eventName - Event to look up
	 * @throws If the event name is not defined
	 */
	getEventSchema(eventName: string): ZodType;
	/**
	 * Returns the Zod schema for a given error code.
	 * @param errorCode - Error code to look up
	 * @throws If the error code is not defined
	 */
	getErrorSchema(errorCode: string): ZodType;
	/**
	 * Checks if a state name is defined in this workflow.
	 * @param stateName - State name to check
	 */
	hasState(stateName: string): boolean;
	/**
	 * Converts a workflow to a JSON-safe snapshot. Dates are serialized as ISO 8601 strings.
	 * @param workflow - The workflow to snapshot
	 * @returns A plain JSON-safe snapshot object
	 */
	snapshot(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	/**
	 * Validates and reconstructs a workflow from a snapshot.
	 * @param snapshot - The snapshot to restore
	 * @returns A result: `{ ok: true, workflow }` or `{ ok: false, error }`
	 */
	restore(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError };
}

/**
 * Creates a workflow definition from a name and Zod schema configuration.
 *
 * @param name - Unique name for this workflow type
 * @param config - Object with `states`, `commands`, `events`, `errors` — each a record of Zod schemas
 * @returns A {@link WorkflowDefinition} with methods for creating instances and accessing schemas
 */
export function defineWorkflow<const TConfig extends WorkflowConfig>(
	name: string,
	config: TConfig,
): WorkflowDefinition<TConfig> { ... }
```

- [ ] **Step 2: Run typecheck**

```bash
cd /home/ralph/ryte/packages/core && pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/definition.ts
git commit -m "docs: enrich JSDoc in core/definition.ts with param tags and descriptions"
```

---

### Task 5: Enrich JSDoc in remaining core source files

**Files:**
- Modify: `packages/core/src/context.ts`
- Modify: `packages/core/src/key.ts`
- Modify: `packages/core/src/plugin.ts`
- Modify: `packages/core/src/router.ts`
- Modify: `packages/core/src/snapshot.ts`
- Modify: `packages/core/src/migration.ts`
- Modify: `packages/core/src/hooks.ts`
- Modify: `packages/core/src/middleware.ts`
- Modify: `packages/core/src/handler.ts`
- Modify: `packages/core/src/readonly-context.ts`

- [ ] **Step 1: Enrich context.ts — add @param to Context interface methods**

```ts
/** Mutable context flowing through the middleware pipeline during dispatch. */
export interface Context<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig> = StateNames<TConfig>,
	TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> {
	/** The command being dispatched, with type and validated payload. */
	readonly command: {
		readonly type: TCommand;
		readonly payload: CommandPayload<TConfig, TCommand>;
	};
	/** The original workflow before any mutations. */
	readonly workflow: WorkflowOf<TConfig, TState>;
	/** Dependencies injected via the router constructor. */
	readonly deps: TDeps;

	/** Current state data (reflects mutations from {@link update}). */
	readonly data: StateData<TConfig, TState>;
	/**
	 * Merges partial data into the current state. Validates against the state's Zod schema.
	 * @param data - Partial state data to merge
	 */
	update(data: Partial<StateData<TConfig, TState>>): void;

	/**
	 * Transitions the workflow to a new state with new data. Validates against the target state's Zod schema.
	 * @param target - Target state name
	 * @param data - Data for the target state
	 */
	transition<Target extends StateNames<TConfig>>(
		target: Target,
		data: StateData<TConfig, Target>,
	): void;

	/**
	 * Emits a domain event. Validates event data against the event's Zod schema.
	 * @param event - Event with type and data
	 */
	emit<E extends EventNames<TConfig>>(event: { type: E; data: EventData<TConfig, E> }): void;
	/** Accumulated events emitted during this dispatch. */
	readonly events: ReadonlyArray<{ type: EventNames<TConfig>; data: unknown }>;

	/**
	 * Signals a domain error. Validates error data and throws internally (caught by the router).
	 * @param err - Error with code and data
	 */
	error<C extends ErrorCodes<TConfig>>(err: { code: C; data: ErrorData<TConfig, C> }): never;

	/**
	 * Stores a value in context-scoped middleware state.
	 * @param key - A {@link ContextKey} created via {@link createKey}
	 * @param value - The value to store
	 */
	set<T>(key: ContextKey<T>, value: T): void;
	/**
	 * Retrieves a value from context-scoped middleware state. Throws if not set.
	 * @param key - A {@link ContextKey} created via {@link createKey}
	 */
	get<T>(key: ContextKey<T>): T;
	/**
	 * Retrieves a value from context-scoped middleware state, or `undefined` if not set.
	 * @param key - A {@link ContextKey} created via {@link createKey}
	 */
	getOrNull<T>(key: ContextKey<T>): T | undefined;

	/** @internal — not part of the handler API */
	getWorkflowSnapshot(): Workflow<TConfig>;
}
```

- [ ] **Step 2: Enrich key.ts**

```ts
/** A phantom-typed key for type-safe middleware state storage via {@link Context.set} and {@link Context.get}. */
export interface ContextKey<T> {
	/** @internal Phantom type brand — not used at runtime. */
	readonly _phantom: T;
	/** Internal symbol providing uniqueness. */
	readonly id: symbol;
}

/**
 * Creates a unique typed key for storing and retrieving values in context.
 *
 * @param name - Debug label (uniqueness comes from an internal `Symbol`)
 * @returns A {@link ContextKey} for use with `ctx.set()`, `ctx.get()`, and `ctx.getOrNull()`
 */
export function createKey<T>(name: string): ContextKey<T> { ... }
```

- [ ] **Step 3: Enrich plugin.ts**

```ts
/** A branded plugin function that can be passed to {@link WorkflowRouter.use}. */
export type Plugin<...> = ...;

/**
 * Brands a function as a Ryte plugin for use with {@link WorkflowRouter.use}.
 *
 * @param fn - A function that configures a router (adds handlers, middleware, hooks)
 * @returns A branded {@link Plugin} function
 */
export function definePlugin<...>(...): Plugin<...> { ... }

/**
 * Checks whether a value is a branded Ryte plugin.
 *
 * @param value - The value to check
 * @returns `true` if the value is a {@link Plugin}
 */
export function isPlugin(value: unknown): value is Plugin<WorkflowConfig, unknown> { ... }
```

- [ ] **Step 4: Enrich router.ts — RouterOptions and WorkflowRouter public methods**

```ts
/** Options for the {@link WorkflowRouter} constructor. */
export interface RouterOptions {
	/** Callback invoked when a lifecycle hook throws. Defaults to `console.error`. */
	onHookError?: (error: unknown) => void;
}
```

For `WorkflowRouter`:
- Constructor JSDoc: add `@param definition`, `@param deps`, `@param options`
- `.use()`: add `@param arg` describing the three overload types
- `.state()`: add `@param name`, `@param setup`
- `.on()` hooks overloads: already documented, add `@param event`, `@param callback` to each
- `.on()` wildcard: add `@param _state`, `@param command`, `@param fns`
- `.dispatch()`: add `@param workflow`, `@param command`, `@returns`

- [ ] **Step 5: Enrich snapshot.ts**

```ts
/** A plain, JSON-safe representation of a workflow's state for serialization and storage. */
export interface WorkflowSnapshot<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** Unique workflow instance identifier. */
	readonly id: string;
	/** Name of the workflow definition. */
	readonly definitionName: string;
	/** Current state name. */
	readonly state: StateNames<TConfig>;
	/** State data (untyped — validated on {@link WorkflowDefinition.restore}). */
	readonly data: unknown;
	/** ISO 8601 timestamp of workflow creation. */
	readonly createdAt: string;
	/** ISO 8601 timestamp of last state change. */
	readonly updatedAt: string;
	/** Schema version number for migration support. */
	readonly modelVersion: number;
}
```

- [ ] **Step 6: Enrich migration.ts**

```ts
/** A function that transforms a snapshot's data from one version to the next. */
export type MigrationFn = ...;

/**
 * A migration entry — either a bare {@link MigrationFn} or an object with a description.
 * The description is forwarded to {@link MigrateOptions.onStep} for logging/debugging.
 */
export type MigrationEntry = ...;

/** A validated migration pipeline ready to transform snapshots. */
export interface MigrationPipeline<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** The workflow definition this pipeline targets. */
	readonly definition: WorkflowDefinition<TConfig>;
	/** The target model version (must match `definition.config.modelVersion`). */
	readonly targetVersion: number;
	/** Map from target version number to migration function. */
	readonly migrations: ReadonlyMap<number, NormalizedMigration>;
}

/** Result of {@link migrate}. */
export type MigrateResult = ...;

/** Options for {@link migrate}. */
export interface MigrateOptions {
	/**
	 * Called after each successful migration step.
	 * @param fromVersion - Source version
	 * @param toVersion - Target version
	 * @param snapshot - Snapshot after transformation
	 * @param description - Optional migration description
	 */
	onStep?: (...) => void;
	/**
	 * Called when a migration step fails.
	 * @param error - The migration error with version details
	 */
	onError?: (error: MigrationError) => void;
}

/**
 * Error thrown when a migration step fails.
 *
 * @param fromVersion - Source version that was being migrated from
 * @param toVersion - Target version that was being migrated to
 * @param cause - The underlying error
 */
export class MigrationError extends Error { ... }

/**
 * Creates a validated migration pipeline from a definition and version-keyed transform functions.
 * Each key is the target version — the function transforms from (key - 1) to key.
 *
 * @param definition - The workflow definition (must have `modelVersion` set if migrations exist)
 * @param migrationMap - Record of version numbers to migration entries
 * @returns A validated {@link MigrationPipeline}
 * @throws If migration keys are not sequential or don't match `definition.config.modelVersion`
 */
export function defineMigrations<TConfig extends WorkflowConfig>(...): MigrationPipeline<TConfig> { ... }

/**
 * Runs the migration chain from the snapshot's modelVersion to the pipeline's targetVersion.
 * Auto-stamps `modelVersion` after each step.
 *
 * @param pipeline - The validated migration pipeline
 * @param snapshot - The snapshot to migrate
 * @param options - Optional callbacks for logging and error handling
 * @returns A {@link MigrateResult}: `{ ok: true, snapshot }` or `{ ok: false, error }`
 */
export function migrate<TConfig extends WorkflowConfig>(...): MigrateResult { ... }
```

- [ ] **Step 7: Enrich hooks.ts, middleware.ts, handler.ts, readonly-context.ts**

These files already have decent JSDoc. Add `@param` tags where missing:

**hooks.ts** — `HookEvent` already documented. No exported functions need `@param` tags (HookRegistry is internal).

**middleware.ts** — already has good JSDoc with usage examples. No `@param` needed (it's a type alias).

**handler.ts** — already documented. No `@param` needed (it's a type alias).

**readonly-context.ts** — already documented. No `@param` needed (it's a type alias).

- [ ] **Step 8: Run typecheck and TypeDoc to validate**

```bash
cd /home/ralph/ryte/packages/core && pnpm typecheck
cd /home/ralph/ryte && pnpm turbo run docs:api
```

Expected: Both PASS with no warnings (TypeDoc with `treatWarningsAsErrors`).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/key.ts packages/core/src/plugin.ts packages/core/src/router.ts packages/core/src/snapshot.ts packages/core/src/migration.ts packages/core/src/hooks.ts packages/core/src/middleware.ts packages/core/src/handler.ts packages/core/src/readonly-context.ts
git commit -m "docs: enrich JSDoc across all core source files"
```

---

## Chunk 3: JSDoc Enrichment — @rytejs/testing + VitePress Integration + Cleanup

### Task 6: Enrich JSDoc in packages/testing/src/

**Files:**
- Modify: `packages/testing/src/assertions.ts`
- Modify: `packages/testing/src/create-test-workflow.ts`
- Modify: `packages/testing/src/create-test-deps.ts`
- Modify: `packages/testing/src/test-path.ts`
- Modify: `packages/testing/src/migration-testing.ts`

- [ ] **Step 1: Enrich assertions.ts**

```ts
/**
 * Asserts that a dispatch result is ok. Optionally checks the resulting state.
 * Throws on failure — works with any test runner.
 *
 * @param result - The dispatch result to assert on
 * @param expectedState - If provided, also asserts the workflow is in this state
 */
export function expectOk<TConfig extends WorkflowConfig>(...): asserts result is ... { ... }

/**
 * Asserts that a dispatch result is an error with the given category.
 * Optionally checks the error code (for domain/router errors).
 * Throws on failure — works with any test runner.
 *
 * @param result - The dispatch result to assert on
 * @param category - Expected error category
 * @param code - If provided, also asserts the error code matches (for `"domain"` and `"router"` categories)
 */
export function expectError<TConfig extends WorkflowConfig>(...): asserts result is ... { ... }
```

- [ ] **Step 2: Enrich create-test-workflow.ts**

```ts
/**
 * Creates a workflow in any state without dispatching through the handler chain.
 * Validates data against the state's Zod schema.
 *
 * @param definition - The workflow definition to create from
 * @param state - The state to place the workflow in
 * @param data - State data (validated against the state's Zod schema)
 * @param options - Optional configuration (e.g., custom ID)
 * @returns A workflow instance in the specified state
 */
export function createTestWorkflow<...>(...): Workflow<TConfig> { ... }
```

- [ ] **Step 3: Enrich create-test-deps.ts**

```ts
/**
 * Creates a test dependencies object from a partial.
 * Returns the partial cast to the full type — does not proxy or throw on un-stubbed access.
 * Provide only the dependencies your test needs.
 *
 * @param partial - Partial dependencies object with only the methods/properties your test requires
 * @returns The partial cast to the full dependency type
 */
export function createTestDeps<T>(partial: Partial<T>): T { ... }
```

- [ ] **Step 4: Enrich test-path.ts**

```ts
/**
 * Tests a sequence of commands and verifies the expected state after each dispatch.
 * Creates the initial workflow from the first step's start/data, then chains dispatch results.
 * Throws on failure — works with any test runner.
 *
 * @param router - The workflow router to dispatch commands through
 * @param definition - The workflow definition (used to create the initial workflow)
 * @param steps - Array of {@link PathStep} objects defining the command sequence
 */
export async function testPath<...>(...): Promise<void> { ... }
```

- [ ] **Step 5: Enrich migration-testing.ts**

```ts
/**
 * Tests a single migration step.
 * Calls the migration function for (`from` + 1) directly and asserts output data matches expected.
 *
 * @param pipeline - The migration pipeline containing the migration to test
 * @param options - Test configuration: source version, input data, expected output data
 */
export function testMigration<...>(...): void { ... }

/**
 * Tests the full migration chain and asserts final version and data.
 *
 * @param pipeline - The migration pipeline to run
 * @param options - Test configuration: source version, input data, expected final version and data
 */
export function testMigrationPath<...>(...): void { ... }

/**
 * Tests migrate + restore round-trip. Derives the definition from the pipeline.
 *
 * @param pipeline - The migration pipeline to run
 * @param options - Test configuration: source version, input data, optional expected final state
 */
export function testMigrationRestore<...>(...): void { ... }
```

- [ ] **Step 6: Run typecheck and TypeDoc**

```bash
cd /home/ralph/ryte/packages/testing && pnpm typecheck
cd /home/ralph/ryte && pnpm turbo run docs:api
```

Expected: Both PASS

- [ ] **Step 7: Commit**

```bash
git add packages/testing/src/assertions.ts packages/testing/src/create-test-workflow.ts packages/testing/src/create-test-deps.ts packages/testing/src/test-path.ts packages/testing/src/migration-testing.ts
git commit -m "docs: enrich JSDoc across all testing source files"
```

---

### Task 7: Update VitePress configuration

**Files:**
- Modify: `docs/.vitepress/config.ts`

- [ ] **Step 1: Update sidebar and nav**

The sidebar `/api/` section should be updated to match the actual generated file paths discovered in Task 1 Step 4. Based on the expected output:

```ts
// In config.ts sidebar:
"/api/": [
  {
    text: "API Reference",
    items: [
      { text: "@rytejs/core", link: "/api/core" },
      { text: "@rytejs/testing", link: "/api/testing" },
    ],
  },
],
```

Update the nav link to point to the core API page:

```ts
{ text: "API", link: "/api/core" },
```

**Note**: Adjust link paths if TypeDoc generated a different structure (e.g., `/api/core/index` instead of `/api/core`).

- [ ] **Step 2: Verify the docs site builds and pages render**

```bash
cd /home/ralph/ryte && pnpm turbo run docs#build
```

Then preview:

```bash
cd /home/ralph/ryte/docs && pnpm preview
```

Open the preview URL and verify:
- Nav "API" link works
- Sidebar shows "@rytejs/core" and "@rytejs/testing"
- Both API pages render with generated content
- Function signatures, parameter tables, and descriptions appear

- [ ] **Step 3: Commit**

```bash
git add docs/.vitepress/config.ts
git commit -m "docs: update VitePress sidebar for generated API reference"
```

---

### Task 8: Cleanup — delete old docs, update .gitignore

**Files:**
- Delete: `docs/api/index.md`
- Modify: `.gitignore`

- [ ] **Step 1: Delete the old hand-written API reference**

```bash
git rm docs/api/index.md
```

- [ ] **Step 2: Add docs/api/ to .gitignore**

Add to `.gitignore`:

```
docs/api/
```

This prevents generated TypeDoc output from being committed. If a hand-written `docs/api/index.md` redirect is needed (determined in Task 1 Step 4), exclude it from the pattern with `!docs/api/index.md`.

- [ ] **Step 3: Final end-to-end verification**

```bash
cd /home/ralph/ryte && pnpm turbo run docs#build --force
```

Expected: Full pipeline runs — packages build → TypeDoc generates → VitePress builds — all clean, no warnings.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: remove hand-written API docs, gitignore generated output"
```

- [ ] **Step 5: Push**

```bash
git push
```
