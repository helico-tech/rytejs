# Phase 3: Migrations & Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add schema migration support (`defineMigrations`, `migrate`, `MigrationError`) to `@rytejs/core`, migration testing utilities to `@rytejs/testing`, and observability recipe documentation.

**Architecture:** Migrations live in a single new `migration.ts` module in core. The `defineMigrations()` function validates a version-keyed migration map at creation time and returns a `MigrationPipeline`. The `migrate()` function runs the chain synchronously, auto-stamping `modelVersion` after each step. The testing package gets three new helpers that build on `migrate()` and `restore()`. Observability is documentation only.

**Tech Stack:** TypeScript 5.7+, Zod 4.x, Vitest 3.x, tsup 8.x, pnpm workspaces, Biome 2.x

---

## File Structure

### New Files (core)
- `packages/core/src/migration.ts` — `MigrationFn`, `MigrationPipeline`, `MigrateResult`, `MigrateOptions`, `MigrationError`, `defineMigrations()`, `migrate()`

### New Test Files (core)
- `packages/core/__tests__/migration.test.ts`

### New Files (testing)
- `packages/testing/src/migration-testing.ts` — `testMigration()`, `testMigrationPath()`, `testMigrationRestore()`

### New Test Files (testing)
- `packages/testing/__tests__/migration-testing.test.ts`

### Modified Files
- `packages/core/src/index.ts` — export new migration types and functions
- `packages/testing/src/index.ts` — export new migration testing utilities

### New Documentation
- `docs/guide/migrations.md`
- `docs/guide/observability.md`
- `docs/.vitepress/config.ts` — add to sidebar
- `docs/api/index.md` — add migration API entries

---

## Chunk 1: Schema Migrations

### Task 1: MigrationError + Types

**Files:**
- Create: `packages/core/src/migration.ts`

- [ ] **Step 1: Create migration module with types and MigrationError**

Create `packages/core/src/migration.ts`:

```ts
import type { WorkflowConfig } from "./types.js";
import type { WorkflowDefinition } from "./definition.js";
import type { WorkflowSnapshot } from "./snapshot.js";

/** A function that transforms a snapshot's data from one version to the next. */
export type MigrationFn = (snapshot: WorkflowSnapshot) => WorkflowSnapshot;

/** A validated migration pipeline ready to transform snapshots. */
export interface MigrationPipeline<TConfig extends WorkflowConfig = WorkflowConfig> {
	readonly definition: WorkflowDefinition<TConfig>;
	readonly targetVersion: number;
	readonly migrations: ReadonlyMap<number, MigrationFn>;
}

/** Result of migrate(). */
export type MigrateResult =
	| { ok: true; snapshot: WorkflowSnapshot }
	| { ok: false; error: MigrationError };

/** Options for migrate(). */
export interface MigrateOptions {
	onStep?: (fromVersion: number, toVersion: number, snapshot: WorkflowSnapshot) => void;
	onError?: (error: MigrationError) => void;
}

/** Error thrown when a migration step fails. */
export class MigrationError extends Error {
	constructor(
		public readonly fromVersion: number,
		public readonly toVersion: number,
		public readonly cause: unknown,
	) {
		super(
			`Migration ${fromVersion} → ${toVersion} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		this.name = "MigrationError";
	}
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/migration.ts
git commit -m "feat: add migration types and MigrationError"
```

---

### Task 2: defineMigrations()

**Files:**
- Modify: `packages/core/src/migration.ts`
- Create: `packages/core/__tests__/migration.test.ts`

- [ ] **Step 1: Write failing tests for defineMigrations**

Create `packages/core/__tests__/migration.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { defineMigrations } from "../src/migration.js";

const definitionV3 = defineWorkflow("order", {
	modelVersion: 3,
	states: {
		Draft: z.object({ items: z.array(z.string()), status: z.string(), fullName: z.string() }),
	},
	commands: {},
	events: {},
	errors: {},
});

const definitionV1 = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
	},
	commands: {},
	events: {},
	errors: {},
});

describe("defineMigrations()", () => {
	test("creates a pipeline with valid migrations", () => {
		const pipeline = defineMigrations(definitionV3, {
			2: (snap) => ({
				...snap,
				data: { ...(snap.data as any), status: "active" },
			}),
			3: (snap) => ({
				...snap,
				data: { ...(snap.data as any), fullName: "unknown" },
			}),
		});

		expect(pipeline.targetVersion).toBe(3);
		expect(pipeline.migrations.size).toBe(2);
		expect(pipeline.definition).toBe(definitionV3);
	});

	test("throws if migration key is <= 1", () => {
		expect(() =>
			defineMigrations(definitionV3, {
				1: (snap) => snap,
				2: (snap) => snap,
				3: (snap) => snap,
			}),
		).toThrow("Migration keys must be > 1");
	});

	test("throws if there are gaps in version sequence", () => {
		expect(() =>
			defineMigrations(definitionV3, {
				2: (snap) => snap,
				// missing 3
			}),
		).toThrow("gap");
	});

	test("throws if highest key doesn't match definition modelVersion", () => {
		expect(() =>
			defineMigrations(definitionV3, {
				2: (snap) => snap,
				3: (snap) => snap,
				4: (snap) => snap,
			}),
		).toThrow("does not match");
	});

	test("accepts empty map for modelVersion 1 definition", () => {
		const pipeline = defineMigrations(definitionV1, {});
		expect(pipeline.targetVersion).toBe(1);
		expect(pipeline.migrations.size).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/migration.test.ts`
Expected: FAIL — `defineMigrations is not a function`

- [ ] **Step 3: Implement defineMigrations**

Add to `packages/core/src/migration.ts`:

```ts
/**
 * Creates a validated migration pipeline from a definition and version-keyed transform functions.
 * Each key is the target version — the function transforms from (key - 1) to key.
 */
export function defineMigrations<TConfig extends WorkflowConfig>(
	definition: WorkflowDefinition<TConfig>,
	migrationMap: Record<number, MigrationFn>,
): MigrationPipeline<TConfig> {
	const targetVersion = definition.config.modelVersion ?? 1;
	const entries = Object.entries(migrationMap).map(([k, v]) => [Number(k), v] as const);

	// Validate keys
	for (const [version] of entries) {
		if (version <= 1) {
			throw new Error(
				`Migration keys must be > 1 (version 1 is the baseline). Got: ${version}`,
			);
		}
	}

	// Sort by version
	entries.sort((a, b) => a[0] - b[0]);

	// Check for gaps and match with targetVersion
	if (entries.length > 0) {
		const highest = entries[entries.length - 1]![0];
		if (highest !== targetVersion) {
			throw new Error(
				`Highest migration key (${highest}) does not match definition modelVersion (${targetVersion})`,
			);
		}
		for (let i = 0; i < entries.length; i++) {
			const expected = targetVersion - entries.length + 1 + i;
			if (entries[i]![0] !== expected) {
				throw new Error(
					`Migration version gap: expected ${expected} but found ${entries[i]![0]}. Migrations must be sequential from 2 to ${targetVersion}.`,
				);
			}
		}
	}

	return {
		definition,
		targetVersion,
		migrations: new Map(entries),
	};
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run __tests__/migration.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/migration.ts packages/core/__tests__/migration.test.ts
git commit -m "feat: add defineMigrations() with validation"
```

---

### Task 3: migrate()

**Files:**
- Modify: `packages/core/src/migration.ts`
- Modify: `packages/core/__tests__/migration.test.ts`

- [ ] **Step 1: Write failing tests for migrate**

Append to `packages/core/__tests__/migration.test.ts`:

```ts
import { migrate, MigrationError } from "../src/migration.js";
import { vi } from "vitest";

describe("migrate()", () => {
	const pipeline = defineMigrations(definitionV3, {
		2: (snap) => ({
			...snap,
			data: { ...(snap.data as any), status: "active" },
		}),
		3: (snap) => ({
			...snap,
			data: { ...(snap.data as any), fullName: "unknown" },
		}),
	});

	function makeSnapshot(version: number, data: unknown = { items: [] }) {
		return {
			id: "wf-1",
			definitionName: "order",
			state: "Draft" as const,
			data,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: version,
		};
	}

	test("runs migration chain v1 → v3", () => {
		const result = migrate(pipeline, makeSnapshot(1));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot.modelVersion).toBe(3);
			expect(result.snapshot.data).toEqual({
				items: [],
				status: "active",
				fullName: "unknown",
			});
		}
	});

	test("returns snapshot as-is when already at target version", () => {
		const snap = makeSnapshot(3, { items: [], status: "active", fullName: "known" });
		const result = migrate(pipeline, snap);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot).toEqual(snap);
		}
	});

	test("returns error when snapshot version is higher than target", () => {
		const result = migrate(pipeline, makeSnapshot(5));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(MigrationError);
			expect(result.error.message).toContain("higher");
		}
	});

	test("returns error when snapshot modelVersion is not a positive integer", () => {
		const result = migrate(pipeline, makeSnapshot(0));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(MigrationError);
		}
	});

	test("returns error when definitionName doesn't match", () => {
		const snap = { ...makeSnapshot(1), definitionName: "other" };
		const result = migrate(pipeline, snap);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("definition");
		}
	});

	test("auto-stamps modelVersion after each step", () => {
		const versions: number[] = [];
		migrate(pipeline, makeSnapshot(1), {
			onStep: (_from, _to, snap) => {
				versions.push(snap.modelVersion);
			},
		});
		expect(versions).toEqual([2, 3]);
	});

	test("catches migration function errors and returns MigrationError", () => {
		const badPipeline = defineMigrations(
			defineWorkflow("bad", {
				modelVersion: 2,
				states: { A: z.object({}) },
				commands: {},
				events: {},
				errors: {},
			}),
			{
				2: () => {
					throw new Error("transform broke");
				},
			},
		);
		const snap = {
			id: "wf-1",
			definitionName: "bad",
			state: "A" as const,
			data: {},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
		};
		const result = migrate(badPipeline, snap);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(MigrationError);
			expect(result.error.fromVersion).toBe(1);
			expect(result.error.toVersion).toBe(2);
			expect(result.error.message).toContain("transform broke");
		}
	});

	test("onError callback fires on failure", () => {
		const onError = vi.fn();
		const badPipeline = defineMigrations(
			defineWorkflow("bad", {
				modelVersion: 2,
				states: { A: z.object({}) },
				commands: {},
				events: {},
				errors: {},
			}),
			{
				2: () => {
					throw new Error("fail");
				},
			},
		);
		const snap = {
			id: "wf-1",
			definitionName: "bad",
			state: "A" as const,
			data: {},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
		};
		migrate(badPipeline, snap, { onError });
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0]).toBeInstanceOf(MigrationError);
	});

	test("onStep callback fires for each successful step", () => {
		const onStep = vi.fn();
		migrate(pipeline, makeSnapshot(1), { onStep });
		expect(onStep).toHaveBeenCalledTimes(2);
		expect(onStep.mock.calls[0][0]).toBe(1); // fromVersion
		expect(onStep.mock.calls[0][1]).toBe(2); // toVersion
		expect(onStep.mock.calls[1][0]).toBe(2);
		expect(onStep.mock.calls[1][1]).toBe(3);
	});

	test("no-op pipeline for modelVersion 1 returns snapshot as-is", () => {
		const noopPipeline = defineMigrations(definitionV1, {});
		const snap = makeSnapshot(1);
		const result = migrate(noopPipeline, snap);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot).toEqual(snap);
		}
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/migration.test.ts`
Expected: FAIL — `migrate is not a function`

- [ ] **Step 3: Implement migrate**

Add to `packages/core/src/migration.ts`:

```ts
/**
 * Runs the migration chain from the snapshot's modelVersion to the pipeline's targetVersion.
 * Returns a Result. Auto-stamps modelVersion after each step.
 */
export function migrate(
	pipeline: MigrationPipeline,
	snapshot: WorkflowSnapshot,
	options?: MigrateOptions,
): MigrateResult {
	// Validate snapshot
	if (!Number.isInteger(snapshot.modelVersion) || snapshot.modelVersion < 1) {
		const error = new MigrationError(
			snapshot.modelVersion,
			pipeline.targetVersion,
			new Error(`Invalid snapshot modelVersion: ${snapshot.modelVersion}. Must be a positive integer.`),
		);
		options?.onError?.(error);
		return { ok: false, error };
	}

	if (snapshot.definitionName !== pipeline.definition.name) {
		const error = new MigrationError(
			snapshot.modelVersion,
			pipeline.targetVersion,
			new Error(
				`Snapshot definition '${snapshot.definitionName}' does not match pipeline definition '${pipeline.definition.name}'`,
			),
		);
		options?.onError?.(error);
		return { ok: false, error };
	}

	if (snapshot.modelVersion > pipeline.targetVersion) {
		const error = new MigrationError(
			snapshot.modelVersion,
			pipeline.targetVersion,
			new Error(
				`Snapshot modelVersion (${snapshot.modelVersion}) is higher than target (${pipeline.targetVersion}). Cannot downgrade.`,
			),
		);
		options?.onError?.(error);
		return { ok: false, error };
	}

	// Already at target version
	if (snapshot.modelVersion === pipeline.targetVersion) {
		return { ok: true, snapshot };
	}

	// Run migration chain
	let current = { ...snapshot };
	for (let version = current.modelVersion + 1; version <= pipeline.targetVersion; version++) {
		const fn = pipeline.migrations.get(version);
		if (!fn) {
			const error = new MigrationError(
				version - 1,
				version,
				new Error(`No migration function found for version ${version}`),
			);
			options?.onError?.(error);
			return { ok: false, error };
		}

		const fromVersion = version - 1;
		try {
			current = { ...fn(current), modelVersion: version };
		} catch (cause) {
			const error = new MigrationError(fromVersion, version, cause);
			options?.onError?.(error);
			return { ok: false, error };
		}

		options?.onStep?.(fromVersion, version, current);
	}

	return { ok: true, snapshot: current };
}
```

- [ ] **Step 4: Run all tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/migration.ts packages/core/__tests__/migration.test.ts
git commit -m "feat: add migrate() with error handling and callbacks"
```

---

### Task 4: Export Migrations from Core

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

Add to `packages/core/src/index.ts`:

```ts
export type { MigrateOptions, MigrateResult, MigrationFn, MigrationPipeline } from "./migration.js";
export { MigrationError, defineMigrations, migrate } from "./migration.js";
```

- [ ] **Step 2: Run typecheck and tests**

Run: `cd packages/core && npx tsc --noEmit && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export migration API from core"
```

---

## Chunk 2: Migration Testing Utilities

### Task 5: Migration Testing Helpers

**Files:**
- Create: `packages/testing/src/migration-testing.ts`
- Create: `packages/testing/__tests__/migration-testing.test.ts`
- Modify: `packages/testing/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/testing/__tests__/migration-testing.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, defineMigrations } from "@rytejs/core";
import {
	testMigration,
	testMigrationPath,
	testMigrationRestore,
} from "../src/migration-testing.js";

const definition = defineWorkflow("task", {
	modelVersion: 3,
	states: {
		Draft: z.object({ title: z.string(), status: z.string(), tags: z.array(z.string()) }),
	},
	commands: {},
	events: {},
	errors: {},
});

const migrations = defineMigrations(definition, {
	2: (snap) => ({
		...snap,
		data: { ...(snap.data as any), status: "active" },
	}),
	3: (snap) => ({
		...snap,
		data: { ...(snap.data as any), tags: [] },
	}),
});

describe("testMigration()", () => {
	test("verifies a single migration step", () => {
		testMigration(migrations, {
			from: 1,
			input: { title: "hello" },
			expected: { title: "hello", status: "active" },
		});
	});

	test("throws when output doesn't match expected", () => {
		expect(() =>
			testMigration(migrations, {
				from: 1,
				input: { title: "hello" },
				expected: { title: "hello", status: "wrong" },
			}),
		).toThrow();
	});

	test("verifies step 2 → 3", () => {
		testMigration(migrations, {
			from: 2,
			input: { title: "hello", status: "active" },
			expected: { title: "hello", status: "active", tags: [] },
		});
	});
});

describe("testMigrationPath()", () => {
	test("verifies full migration chain", () => {
		testMigrationPath(migrations, {
			from: 1,
			input: { title: "hello" },
			expectVersion: 3,
			expected: { title: "hello", status: "active", tags: [] },
		});
	});

	test("throws when final version doesn't match", () => {
		expect(() =>
			testMigrationPath(migrations, {
				from: 1,
				input: { title: "hello" },
				expectVersion: 2,
				expected: { title: "hello", status: "active" },
			}),
		).toThrow("version");
	});

	test("throws when final data doesn't match", () => {
		expect(() =>
			testMigrationPath(migrations, {
				from: 1,
				input: { title: "hello" },
				expectVersion: 3,
				expected: { title: "wrong" },
			}),
		).toThrow();
	});
});

describe("testMigrationRestore()", () => {
	test("verifies migrate + restore round-trip", () => {
		testMigrationRestore(migrations, {
			from: 1,
			input: { title: "hello" },
			expectState: "Draft",
		});
	});

	test("throws when restore fails (bad migration output)", () => {
		const badMigrations = defineMigrations(
			defineWorkflow("bad", {
				modelVersion: 2,
				states: { Draft: z.object({ required: z.string() }) },
				commands: {},
				events: {},
				errors: {},
			}),
			{
				2: (snap) => ({
					...snap,
					data: { notTheRightField: true },
				}),
			},
		);

		expect(() =>
			testMigrationRestore(badMigrations, {
				from: 1,
				input: {},
				expectState: "Draft",
			}),
		).toThrow("restore");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/testing && npx vitest run __tests__/migration-testing.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement migration testing helpers**

Create `packages/testing/src/migration-testing.ts`:

```ts
import type { MigrationPipeline, WorkflowSnapshot } from "@rytejs/core";
import { migrate } from "@rytejs/core";

/** Options for testMigration — single step. */
export interface TestMigrationOptions {
	from: number;
	input: unknown;
	expected: unknown;
	state?: string;
}

/** Options for testMigrationPath — full chain. */
export interface TestMigrationPathOptions {
	from: number;
	input: unknown;
	expectVersion: number;
	expected: unknown;
	state?: string;
}

/** Options for testMigrationRestore — migrate + restore round-trip. */
export interface TestMigrationRestoreOptions {
	from: number;
	input: unknown;
	expectState?: string;
	state?: string;
}

function makeTestSnapshot(
	pipeline: MigrationPipeline,
	version: number,
	data: unknown,
	state?: string,
): WorkflowSnapshot {
	const firstState = state ?? Object.keys(pipeline.definition.config.states)[0];
	if (!firstState) throw new Error("Definition has no states");
	return {
		id: `test-${Math.random().toString(36).slice(2, 9)}`,
		definitionName: pipeline.definition.name,
		state: firstState,
		data,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		modelVersion: version,
	};
}

function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Tests a single migration step.
 * Calls the migration function for (from + 1) directly and asserts output data matches expected.
 */
export function testMigration(pipeline: MigrationPipeline, options: TestMigrationOptions): void {
	const targetVersion = options.from + 1;
	const fn = pipeline.migrations.get(targetVersion);
	if (!fn) {
		throw new Error(`No migration function found for version ${targetVersion}`);
	}

	const snap = makeTestSnapshot(pipeline, options.from, options.input, options.state);
	const result = fn(snap);

	if (!deepEqual(result.data, options.expected)) {
		throw new Error(
			`Migration ${options.from} → ${targetVersion} data mismatch.\nExpected: ${JSON.stringify(options.expected)}\nGot: ${JSON.stringify(result.data)}`,
		);
	}
}

/**
 * Tests the full migration chain and asserts final version and data.
 */
export function testMigrationPath(
	pipeline: MigrationPipeline,
	options: TestMigrationPathOptions,
): void {
	const snap = makeTestSnapshot(pipeline, options.from, options.input, options.state);
	const result = migrate(pipeline, snap);

	if (!result.ok) {
		throw new Error(`Migration failed: ${result.error.message}`);
	}

	if (result.snapshot.modelVersion !== options.expectVersion) {
		throw new Error(
			`Expected final version ${options.expectVersion} but got ${result.snapshot.modelVersion}`,
		);
	}

	if (!deepEqual(result.snapshot.data, options.expected)) {
		throw new Error(
			`Migration path data mismatch.\nExpected: ${JSON.stringify(options.expected)}\nGot: ${JSON.stringify(result.snapshot.data)}`,
		);
	}
}

/**
 * Tests migrate + restore round-trip.
 * Derives the definition from the pipeline.
 */
export function testMigrationRestore(
	pipeline: MigrationPipeline,
	options: TestMigrationRestoreOptions,
): void {
	const snap = makeTestSnapshot(pipeline, options.from, options.input, options.state);
	const migrated = migrate(pipeline, snap);

	if (!migrated.ok) {
		throw new Error(`Migration failed: ${migrated.error.message}`);
	}

	const restored = pipeline.definition.restore(migrated.snapshot);

	if (!restored.ok) {
		throw new Error(
			`Restore failed after migration: ${restored.error.message}`,
		);
	}

	if (options.expectState !== undefined && restored.workflow.state !== options.expectState) {
		throw new Error(
			`Expected state '${options.expectState}' but got '${restored.workflow.state}'`,
		);
	}
}
```

- [ ] **Step 4: Export from barrel**

Add to `packages/testing/src/index.ts`:
```ts
export { testMigration, testMigrationPath, testMigrationRestore } from "./migration-testing.js";
export type {
	TestMigrationOptions,
	TestMigrationPathOptions,
	TestMigrationRestoreOptions,
} from "./migration-testing.js";
```

- [ ] **Step 5: Build core and run tests**

Run: `cd packages/core && npx tsup` (rebuild dist for testing package)
Run: `cd packages/testing && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Run all core tests too**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/testing/src/migration-testing.ts packages/testing/__tests__/migration-testing.test.ts packages/testing/src/index.ts
git commit -m "feat: add migration testing utilities to @rytejs/testing"
```

---

## Chunk 3: Documentation

### Task 6: Migration Guide

**Files:**
- Create: `docs/guide/migrations.md`

- [ ] **Step 1: Write the migrations guide**

Create `docs/guide/migrations.md` following the existing guide style (short intro, sections with code examples, tab indentation in code blocks):

Cover:
- Why migrations exist (schema evolution + `modelVersion`)
- `defineMigrations()` — creating a pipeline
- `migrate()` — running the chain, handling Results
- The full pattern: `migrate()` then `restore()`
- Callbacks (`onStep`, `onError`)
- Testing migrations with `@rytejs/testing`

- [ ] **Step 2: Commit**

```bash
git add docs/guide/migrations.md
git commit -m "docs: add migrations guide"
```

---

### Task 7: Observability Guide

**Files:**
- Create: `docs/guide/observability.md`

- [ ] **Step 1: Write the observability guide**

Create `docs/guide/observability.md` with four copy-pasteable plugin recipes:

1. **Structured logging** — dispatch timing with context keys
2. **OpenTelemetry tracing** — span creation/completion via hooks
3. **Audit trail** — transition and error recording
4. **Metrics** — counter increments for dispatches and transitions

Each recipe should be self-contained with all imports (`createKey`, `definePlugin`). Follow existing guide style.

- [ ] **Step 2: Commit**

```bash
git add docs/guide/observability.md
git commit -m "docs: add observability recipes guide"
```

---

### Task 8: Sidebar + API Reference Updates

**Files:**
- Modify: `docs/.vitepress/config.ts`
- Modify: `docs/api/index.md`

- [ ] **Step 1: Update sidebar**

Add to the "Advanced" section in `docs/.vitepress/config.ts`:
```ts
{ text: "Migrations", link: "/guide/migrations" },
{ text: "Observability", link: "/guide/observability" },
```

- [ ] **Step 2: Update API reference**

Add to `docs/api/index.md`:

- `MigrationFn` type
- `MigrationPipeline<TConfig>` interface
- `MigrateResult` type
- `MigrateOptions` interface
- `MigrationError` class
- `defineMigrations(definition, migrationMap)` function
- `migrate(pipeline, snapshot, options?)` function
- `@rytejs/testing` migration helpers: `testMigration()`, `testMigrationPath()`, `testMigrationRestore()`

- [ ] **Step 3: Commit and push**

```bash
git add docs/
git commit -m "docs: update sidebar and API reference for Phase 3"
git push
```
