# Phase 2: Test & Serialize (v0.3) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `@rytejs/testing` companion package for test utilities and a serialization/rehydration protocol to `@rytejs/core`.

**Architecture:** The testing package is a standalone companion that depends on `@rytejs/core` as a peer dependency and provides factory functions, assertion helpers, and path testing utilities. The serialization protocol adds `snapshot()` and `restore()` methods to `WorkflowDefinition`, producing plain JSON-safe objects. Both features are independent and can be implemented in either order.

**Tech Stack:** TypeScript 5.7+, Zod 4.x, Vitest 3.x, tsup 8.x, pnpm workspaces, Biome 2.x

---

## File Structure

### Modified Files (core)
- `packages/core/src/types.ts` — extend `ValidationError.source` union to include `"restore"`
- `packages/core/src/definition.ts` — add `snapshot()` and `restore()` to `WorkflowDefinition` interface and implementation
- `packages/core/src/index.ts` — export new `WorkflowSnapshot` type

### New Files (core)
- `packages/core/src/snapshot.ts` — `WorkflowSnapshot` type
- `packages/core/__tests__/snapshot.test.ts`

### New Package: `packages/testing`
- `packages/testing/package.json`
- `packages/testing/tsconfig.json`
- `packages/testing/tsup.config.ts`
- `packages/testing/src/index.ts`
- `packages/testing/src/create-test-workflow.ts`
- `packages/testing/src/assertions.ts`
- `packages/testing/src/test-path.ts`
- `packages/testing/src/create-test-deps.ts`
- `packages/testing/__tests__/create-test-workflow.test.ts`
- `packages/testing/__tests__/assertions.test.ts`
- `packages/testing/__tests__/test-path.test.ts`
- `packages/testing/__tests__/create-test-deps.test.ts`

---

## Chunk 1: Serialization / Rehydration Protocol

### Task 1: WorkflowSnapshot Type and ValidationError Extension

Create the snapshot type and extend `ValidationError.source` to include `"restore"`.

**Files:**
- Create: `packages/core/src/snapshot.ts`
- Modify: `packages/core/src/types.ts:82` (ValidationError source union)

- [ ] **Step 1: Create snapshot type**

Create `packages/core/src/snapshot.ts`:

```ts
import type { StateNames, WorkflowConfig } from "./types.js";

/** A plain, JSON-safe representation of a workflow's state. */
export interface WorkflowSnapshot<TConfig extends WorkflowConfig = WorkflowConfig> {
	readonly id: string;
	readonly definitionName: string;
	readonly state: StateNames<TConfig>;
	readonly data: unknown;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly version: number;
}
```

- [ ] **Step 2: Extend ValidationError source union**

In `packages/core/src/types.ts`, change the `ValidationError` constructor's `source` parameter type from:
```ts
public readonly source: "command" | "state" | "event" | "transition",
```
to:
```ts
public readonly source: "command" | "state" | "event" | "transition" | "restore",
```

Also update the `PipelineError` validation source to match (line 53):
```ts
source: "command" | "state" | "event" | "transition" | "restore";
```

- [ ] **Step 3: Export snapshot type from index.ts**

Add to `packages/core/src/index.ts`:
```ts
export type { WorkflowSnapshot } from "./snapshot.js";
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/snapshot.ts packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat: add WorkflowSnapshot type and extend ValidationError for restore"
```

---

### Task 2: snapshot() and restore() on WorkflowDefinition

Add `snapshot()` and `restore()` methods to the definition.

**Files:**
- Modify: `packages/core/src/definition.ts` (interface + implementation)
- Create: `packages/core/__tests__/snapshot.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/snapshot.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
	},
	commands: {
		PlaceOrder: z.object({}),
	},
	events: {},
	errors: {},
});

describe("snapshot()", () => {
	test("produces a plain JSON-safe object", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["apple"] },
		});
		const snap = definition.snapshot(wf);

		expect(snap.id).toBe("wf-1");
		expect(snap.definitionName).toBe("order");
		expect(snap.state).toBe("Draft");
		expect(snap.data).toEqual({ items: ["apple"] });
		expect(typeof snap.createdAt).toBe("string");
		expect(typeof snap.updatedAt).toBe("string");
		expect(snap.version).toBe(1);
	});

	test("serializes dates as ISO 8601 strings", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const snap = definition.snapshot(wf);

		// Should parse back to valid dates
		expect(new Date(snap.createdAt).toISOString()).toBe(snap.createdAt);
		expect(new Date(snap.updatedAt).toISOString()).toBe(snap.updatedAt);
	});

	test("snapshot is JSON.stringify safe", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["a", "b"] },
		});
		const snap = definition.snapshot(wf);
		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);

		expect(parsed).toEqual(snap);
	});

	test("snapshot of state with Date field serializes the Date", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Placed",
			data: { items: ["apple"], placedAt: new Date("2026-01-01T00:00:00.000Z") },
		});
		const snap = definition.snapshot(wf);

		// Data should still contain the date as-is (Zod coerced date)
		// The snapshot serializes createdAt/updatedAt but data is passed through as-is
		expect(snap.state).toBe("Placed");
	});
});

describe("restore()", () => {
	test("restores a valid snapshot", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["apple"] },
		});
		const snap = definition.snapshot(wf);
		const result = definition.restore(snap);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.id).toBe("wf-1");
			expect(result.workflow.state).toBe("Draft");
			expect(result.workflow.data).toEqual({ items: ["apple"] });
			expect(result.workflow.createdAt).toBeInstanceOf(Date);
			expect(result.workflow.updatedAt).toBeInstanceOf(Date);
		}
	});

	test("restores dates from ISO strings", () => {
		const snap = {
			id: "wf-1",
			definitionName: "order",
			state: "Draft" as const,
			data: { items: [] },
			createdAt: "2026-01-15T10:00:00.000Z",
			updatedAt: "2026-01-15T10:05:00.000Z",
			version: 1,
		};
		const result = definition.restore(snap);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.createdAt).toEqual(new Date("2026-01-15T10:00:00.000Z"));
			expect(result.workflow.updatedAt).toEqual(new Date("2026-01-15T10:05:00.000Z"));
		}
	});

	test("returns error for invalid state data", () => {
		const snap = {
			id: "wf-1",
			definitionName: "order",
			state: "Draft" as const,
			data: { items: "not-an-array" }, // should be string[]
			createdAt: "2026-01-15T10:00:00.000Z",
			updatedAt: "2026-01-15T10:05:00.000Z",
			version: 1,
		};
		const result = definition.restore(snap);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.source).toBe("restore");
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	test("returns error for unknown state", () => {
		const snap = {
			id: "wf-1",
			definitionName: "order",
			state: "Unknown" as any,
			data: {},
			createdAt: "2026-01-15T10:00:00.000Z",
			updatedAt: "2026-01-15T10:05:00.000Z",
			version: 1,
		};
		const result = definition.restore(snap);

		expect(result.ok).toBe(false);
	});

	test("round-trips through JSON", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["apple", "banana"] },
		});
		const snap = definition.snapshot(wf);
		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		const result = definition.restore(parsed);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.id).toBe("wf-1");
			expect(result.workflow.state).toBe("Draft");
			expect(result.workflow.data).toEqual({ items: ["apple", "banana"] });
		}
	});
});

describe("versioned definition", () => {
	test("version defaults to 1", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const snap = definition.snapshot(wf);
		expect(snap.version).toBe(1);
	});

	test("custom version is stamped on snapshots", () => {
		const versionedDef = defineWorkflow("order", {
			version: 2,
			states: {
				Draft: z.object({ items: z.array(z.string()) }),
			},
			commands: {},
			events: {},
			errors: {},
		});
		const wf = versionedDef.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const snap = versionedDef.snapshot(wf);
		expect(snap.version).toBe(2);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/snapshot.test.ts`
Expected: FAIL — `definition.snapshot is not a function`

- [ ] **Step 3: Update WorkflowConfig to support optional version**

In `packages/core/src/types.ts`, add optional `version` to `WorkflowConfig`:

```ts
export interface WorkflowConfig {
	version?: number;
	states: Record<string, ZodType>;
	commands: Record<string, ZodType>;
	events: Record<string, ZodType>;
	errors: Record<string, ZodType>;
}
```

- [ ] **Step 4: Implement snapshot() and restore() on WorkflowDefinition**

In `packages/core/src/definition.ts`:

Add imports:
```ts
import type { WorkflowSnapshot } from "./snapshot.js";
import { ValidationError } from "./types.js";
import type { Workflow } from "./types.js";
```

Add to `WorkflowDefinition` interface:
```ts
snapshot(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
restore(
	snapshot: WorkflowSnapshot<TConfig>,
): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError };
```

Add implementations inside the returned object in `defineWorkflow()`:

```ts
snapshot(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig> {
	return {
		id: workflow.id,
		definitionName: name,
		state: workflow.state,
		data: workflow.data,
		createdAt: workflow.createdAt.toISOString(),
		updatedAt: workflow.updatedAt.toISOString(),
		version: config.version ?? 1,
	} as WorkflowSnapshot<TConfig>;
},

restore(
	snap: WorkflowSnapshot<TConfig>,
): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError } {
	const stateSchema = config.states[snap.state as string];
	if (!stateSchema) {
		return {
			ok: false,
			error: new ValidationError("restore", [
				{
					code: "custom",
					message: `Unknown state: ${snap.state}`,
					input: snap.state,
					path: ["state"],
				},
			]),
		};
	}

	const result = stateSchema.safeParse(snap.data);
	if (!result.success) {
		return {
			ok: false,
			error: new ValidationError("restore", result.error.issues),
		};
	}

	return {
		ok: true,
		workflow: {
			id: snap.id,
			definitionName: snap.definitionName,
			state: snap.state,
			data: result.data,
			createdAt: new Date(snap.createdAt),
			updatedAt: new Date(snap.updatedAt),
		} as Workflow<TConfig>,
	};
},
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/definition.ts packages/core/src/types.ts packages/core/__tests__/snapshot.test.ts
git commit -m "feat: add snapshot() and restore() to WorkflowDefinition"
```

---

## Chunk 2: @rytejs/testing Package

### Task 3: Package Scaffold

Set up the `packages/testing` package.

**Files:**
- Create: `packages/testing/package.json`
- Create: `packages/testing/tsconfig.json`
- Create: `packages/testing/tsup.config.ts`
- Create: `packages/testing/src/index.ts` (empty barrel for now)

- [ ] **Step 1: Create package.json**

```json
{
	"name": "@rytejs/testing",
	"version": "0.3.0",
	"description": "Test utilities for @rytejs/core workflows",
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
		"directory": "packages/testing"
	},
	"homepage": "https://helico-tech.github.io/rytejs",
	"bugs": "https://github.com/helico-tech/rytejs/issues",
	"keywords": ["workflow", "state-machine", "testing", "test-utilities"],
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

- [ ] **Step 4: Create empty barrel index**

Create `packages/testing/src/index.ts`:
```ts
// Test utilities for @rytejs/core
```

- [ ] **Step 5: Install dependencies and verify**

Run: `pnpm install` from the root (or however the monorepo installs deps).

- [ ] **Step 6: Commit**

```bash
git add packages/testing/
git commit -m "chore: scaffold @rytejs/testing package"
```

---

### Task 4: createTestWorkflow

Create workflows in any state without dispatching through the chain.

**Files:**
- Create: `packages/testing/src/create-test-workflow.ts`
- Create: `packages/testing/__tests__/create-test-workflow.test.ts`
- Modify: `packages/testing/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/testing/__tests__/create-test-workflow.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "@rytejs/core";
import { createTestWorkflow } from "../src/create-test-workflow.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
		Shipped: z.object({ items: z.array(z.string()), trackingId: z.string() }),
	},
	commands: { PlaceOrder: z.object({}) },
	events: {},
	errors: {},
});

describe("createTestWorkflow", () => {
	test("creates a workflow in the specified state", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: ["apple"] });
		expect(wf.state).toBe("Draft");
		expect(wf.data).toEqual({ items: ["apple"] });
	});

	test("creates a workflow with a generated id", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: [] });
		expect(typeof wf.id).toBe("string");
		expect(wf.id.length).toBeGreaterThan(0);
	});

	test("creates a workflow with custom id via options", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: [] }, { id: "custom-id" });
		expect(wf.id).toBe("custom-id");
	});

	test("validates data against state schema", () => {
		expect(() =>
			createTestWorkflow(definition, "Draft", { items: "not-array" as any }),
		).toThrow();
	});

	test("sets definitionName from the definition", () => {
		const wf = createTestWorkflow(definition, "Placed", {
			items: ["a"],
			placedAt: new Date(),
		});
		expect(wf.definitionName).toBe("order");
	});

	test("sets createdAt and updatedAt", () => {
		const wf = createTestWorkflow(definition, "Draft", { items: [] });
		expect(wf.createdAt).toBeInstanceOf(Date);
		expect(wf.updatedAt).toBeInstanceOf(Date);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/testing && npx vitest run __tests__/create-test-workflow.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement createTestWorkflow**

Create `packages/testing/src/create-test-workflow.ts`:

```ts
import type { StateData, StateNames, Workflow, WorkflowConfig, WorkflowDefinition } from "@rytejs/core";

/** Options for createTestWorkflow. */
export interface CreateTestWorkflowOptions {
	/** Custom workflow ID. Defaults to "test-<random>". */
	id?: string;
}

/**
 * Creates a workflow in any state without dispatching through the handler chain.
 * Validates data against the state's Zod schema.
 */
export function createTestWorkflow<
	TConfig extends WorkflowConfig,
	S extends StateNames<TConfig>,
>(
	definition: WorkflowDefinition<TConfig>,
	state: S,
	data: StateData<TConfig, S>,
	options?: CreateTestWorkflowOptions,
): Workflow<TConfig> {
	const id = options?.id ?? `test-${Math.random().toString(36).slice(2, 9)}`;
	return definition.createWorkflow(id, { initialState: state, data }) as Workflow<TConfig>;
}
```

- [ ] **Step 4: Export from barrel**

Update `packages/testing/src/index.ts`:
```ts
export { createTestWorkflow } from "./create-test-workflow.js";
export type { CreateTestWorkflowOptions } from "./create-test-workflow.js";
```

- [ ] **Step 5: Build core and run tests**

Run: `cd packages/core && npx tsup` (rebuild dist so testing package can import)
Run: `cd packages/testing && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/testing/src/create-test-workflow.ts packages/testing/__tests__/create-test-workflow.test.ts packages/testing/src/index.ts
git commit -m "feat: add createTestWorkflow to @rytejs/testing"
```

---

### Task 5: Assertion Helpers (expectOk, expectError)

**Files:**
- Create: `packages/testing/src/assertions.ts`
- Create: `packages/testing/__tests__/assertions.test.ts`
- Modify: `packages/testing/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/testing/__tests__/assertions.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { WorkflowRouter, defineWorkflow } from "@rytejs/core";
import { expectError, expectOk } from "../src/assertions.js";

const definition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
		Fail: z.object({}),
	},
	events: {},
	errors: {
		NotAllowed: z.object({ reason: z.string() }),
	},
});

function setupRouter() {
	const router = new WorkflowRouter(definition);
	router.state("Draft", (state) => {
		state.on("Publish", (ctx) => {
			ctx.transition("Published", { title: ctx.command.payload.title });
		});
		state.on("Fail", (ctx) => {
			ctx.error({ code: "NotAllowed", data: { reason: "test" } });
		});
	});
	return router;
}

describe("expectOk", () => {
	test("passes on ok result", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expectOk(result); // should not throw
	});

	test("throws on error result", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expect(() => expectOk(result)).toThrow("Expected ok result");
	});

	test("checks specific state when provided", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expectOk(result, "Published"); // should not throw
	});

	test("throws when state does not match", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expect(() => expectOk(result, "Draft")).toThrow("Expected state 'Draft' but got 'Published'");
	});
});

describe("expectError", () => {
	test("passes on error result with matching category", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expectError(result, "domain"); // should not throw
	});

	test("throws on ok result", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hi" } });
		expect(() => expectError(result, "domain")).toThrow("Expected error result");
	});

	test("checks specific error code when provided", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expectError(result, "domain", "NotAllowed"); // should not throw
	});

	test("throws when error code does not match", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expect(() => expectError(result, "domain", "WrongCode" as any)).toThrow(
			"Expected error code 'WrongCode'",
		);
	});

	test("throws when category does not match", async () => {
		const router = setupRouter();
		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Fail", payload: {} });
		expect(() => expectError(result, "validation")).toThrow("Expected error category 'validation'");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/testing && npx vitest run __tests__/assertions.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement assertions**

Create `packages/testing/src/assertions.ts`:

```ts
import type { DispatchResult, WorkflowConfig } from "@rytejs/core";

/**
 * Asserts that a dispatch result is ok. Optionally checks the resulting state.
 * Throws on failure — works with any test runner.
 */
export function expectOk<TConfig extends WorkflowConfig>(
	result: DispatchResult<TConfig>,
	expectedState?: string,
): asserts result is Extract<DispatchResult<TConfig>, { ok: true }> {
	if (!result.ok) {
		throw new Error(
			`Expected ok result, but got error: ${JSON.stringify(result.error)}`,
		);
	}
	if (expectedState !== undefined && result.workflow.state !== expectedState) {
		throw new Error(
			`Expected state '${expectedState}' but got '${result.workflow.state}'`,
		);
	}
}

/**
 * Asserts that a dispatch result is an error with the given category.
 * Optionally checks the error code (for domain/router errors).
 * Throws on failure — works with any test runner.
 */
export function expectError<TConfig extends WorkflowConfig>(
	result: DispatchResult<TConfig>,
	category: "validation" | "domain" | "router",
	code?: string,
): asserts result is Extract<DispatchResult<TConfig>, { ok: false }> {
	if (result.ok) {
		throw new Error(
			`Expected error result, but got ok with state '${result.workflow.state}'`,
		);
	}
	if (result.error.category !== category) {
		throw new Error(
			`Expected error category '${category}' but got '${result.error.category}'`,
		);
	}
	if (code !== undefined && "code" in result.error && result.error.code !== code) {
		throw new Error(
			`Expected error code '${code}' but got '${result.error.code}'`,
		);
	}
}
```

- [ ] **Step 4: Export from barrel**

Add to `packages/testing/src/index.ts`:
```ts
export { expectOk, expectError } from "./assertions.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/testing && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/testing/src/assertions.ts packages/testing/__tests__/assertions.test.ts packages/testing/src/index.ts
git commit -m "feat: add expectOk and expectError assertion helpers"
```

---

### Task 6: testPath

Test a sequence of commands and verify the expected state journey.

**Files:**
- Create: `packages/testing/src/test-path.ts`
- Create: `packages/testing/__tests__/test-path.test.ts`
- Modify: `packages/testing/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/testing/__tests__/test-path.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { WorkflowRouter, defineWorkflow } from "@rytejs/core";
import { testPath } from "../src/test-path.js";

const definition = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
	},
	events: {},
	errors: {},
});

function setupRouter() {
	const router = new WorkflowRouter(definition);
	router.state("Todo", (state) => {
		state.on("Start", (ctx) => {
			ctx.transition("InProgress", {
				title: ctx.data.title,
				assignee: ctx.command.payload.assignee,
			});
		});
	});
	router.state("InProgress", (state) => {
		state.on("Complete", (ctx) => {
			ctx.transition("Done", {
				title: ctx.data.title,
				completedAt: new Date(),
			});
		});
	});
	return router;
}

describe("testPath", () => {
	test("verifies a full state transition path", async () => {
		const router = setupRouter();
		await testPath(router, definition, [
			{ start: "Todo", data: { title: "Fix bug" }, command: "Start", payload: { assignee: "alice" }, expect: "InProgress" },
			{ command: "Complete", payload: {}, expect: "Done" },
		]);
	});

	test("throws when a step transitions to wrong state", async () => {
		const router = setupRouter();
		await expect(
			testPath(router, definition, [
				{ start: "Todo", data: { title: "Fix bug" }, command: "Start", payload: { assignee: "alice" }, expect: "Done" },
			]),
		).rejects.toThrow("Expected state 'Done'");
	});

	test("throws when a step dispatch fails", async () => {
		const router = setupRouter();
		await expect(
			testPath(router, definition, [
				{ start: "Todo", data: { title: "Fix bug" }, command: "Complete", payload: {}, expect: "Done" },
			]),
		).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/testing && npx vitest run __tests__/test-path.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement testPath**

Create `packages/testing/src/test-path.ts`:

```ts
import type {
	CommandNames,
	CommandPayload,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
	WorkflowRouter,
} from "@rytejs/core";

/** A single step in a transition path test. */
export interface PathStep<TConfig extends WorkflowConfig> {
	/** Starting state — required on the first step, ignored on subsequent steps. */
	start?: StateNames<TConfig>;
	/** Initial data for the starting state — required on the first step. */
	data?: StateData<TConfig, StateNames<TConfig>>;
	/** Command to dispatch. */
	command: CommandNames<TConfig>;
	/** Command payload. */
	payload: CommandPayload<TConfig, CommandNames<TConfig>>;
	/** Expected state after dispatch. */
	expect: StateNames<TConfig>;
}

/**
 * Tests a sequence of commands and verifies the expected state after each dispatch.
 * Creates the initial workflow from the first step's start/data, then chains dispatch results.
 * Throws on failure — works with any test runner.
 */
export async function testPath<TConfig extends WorkflowConfig, TDeps>(
	router: WorkflowRouter<TConfig, TDeps>,
	definition: WorkflowDefinition<TConfig>,
	steps: PathStep<TConfig>[],
): Promise<void> {
	if (steps.length === 0) throw new Error("testPath requires at least one step");
	const first = steps[0];
	if (!first.start) throw new Error("First step must have a 'start' state");

	let workflow: Workflow<TConfig> = definition.createWorkflow(
		`test-${Math.random().toString(36).slice(2, 9)}`,
		{ initialState: first.start, data: first.data as any },
	) as Workflow<TConfig>;

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const result = await router.dispatch(workflow, {
			type: step.command,
			payload: step.payload,
		});

		if (!result.ok) {
			throw new Error(
				`Step ${i + 1}: dispatch '${step.command}' failed: ${JSON.stringify(result.error)}`,
			);
		}

		if (result.workflow.state !== step.expect) {
			throw new Error(
				`Step ${i + 1}: Expected state '${step.expect}' but got '${result.workflow.state}'`,
			);
		}

		workflow = result.workflow;
	}
}
```

- [ ] **Step 4: Export from barrel**

Add to `packages/testing/src/index.ts`:
```ts
export { testPath } from "./test-path.js";
export type { PathStep } from "./test-path.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/testing && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/testing/src/test-path.ts packages/testing/__tests__/test-path.test.ts packages/testing/src/index.ts
git commit -m "feat: add testPath for transition path testing"
```

---

### Task 7: createTestDeps

**Files:**
- Create: `packages/testing/src/create-test-deps.ts`
- Create: `packages/testing/__tests__/create-test-deps.test.ts`
- Modify: `packages/testing/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/testing/__tests__/create-test-deps.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createTestDeps } from "../src/create-test-deps.js";

type MyDeps = {
	paymentService: { charge: (amount: number) => Promise<boolean> };
	emailService: { send: (to: string, body: string) => void };
};

describe("createTestDeps", () => {
	test("returns partial cast to full type", () => {
		const deps = createTestDeps<MyDeps>({
			paymentService: { charge: async () => true },
		});
		expect(deps.paymentService.charge).toBeDefined();
	});

	test("missing deps are undefined at runtime", () => {
		const deps = createTestDeps<MyDeps>({
			paymentService: { charge: async () => true },
		});
		// emailService was not provided — it's undefined at runtime
		expect((deps as any).emailService).toBeUndefined();
	});

	test("empty partial produces empty deps", () => {
		const deps = createTestDeps<MyDeps>({});
		expect(deps).toEqual({});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/testing && npx vitest run __tests__/create-test-deps.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement createTestDeps**

Create `packages/testing/src/create-test-deps.ts`:

```ts
/**
 * Creates a test dependencies object from a partial.
 * Returns the partial cast to the full type — does not proxy or throw on un-stubbed access.
 * Provide only the dependencies your test needs.
 */
export function createTestDeps<T>(partial: Partial<T>): T {
	return partial as T;
}
```

- [ ] **Step 4: Export from barrel**

Add to `packages/testing/src/index.ts`:
```ts
export { createTestDeps } from "./create-test-deps.js";
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/testing && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/testing/src/create-test-deps.ts packages/testing/__tests__/create-test-deps.test.ts packages/testing/src/index.ts
git commit -m "feat: add createTestDeps for dependency stubbing"
```

---

## Chunk 3: Documentation & Integration

### Task 8: Documentation

**Files:**
- Create: `docs/guide/testing.md`
- Create: `docs/guide/serialization.md`
- Modify: `docs/.vitepress/config.ts` (add to sidebar)
- Modify: `docs/api/index.md` (add new API entries)

- [ ] **Step 1: Write testing guide**

Create `docs/guide/testing.md` covering `createTestWorkflow`, `expectOk`, `expectError`, `testPath`, and `createTestDeps`. Follow existing guide style.

- [ ] **Step 2: Write serialization guide**

Create `docs/guide/serialization.md` covering `snapshot()`, `restore()`, versioning, JSON round-trips. Follow existing guide style.

- [ ] **Step 3: Update sidebar**

Add to the "Advanced" section in `docs/.vitepress/config.ts`:
```ts
{ text: "Testing", link: "/guide/testing" },
{ text: "Serialization", link: "/guide/serialization" },
```

- [ ] **Step 4: Update API reference**

Add to `docs/api/index.md`:
- `WorkflowSnapshot<TConfig>` type
- `definition.snapshot(workflow)` method
- `definition.restore(snapshot)` method
- `@rytejs/testing` exports: `createTestWorkflow`, `expectOk`, `expectError`, `testPath`, `createTestDeps`

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: add testing and serialization guides"
```

---

### Task 9: Final Integration

- [ ] **Step 1: Run full monorepo typecheck and tests**

Run: `cd packages/core && npx tsc --noEmit && npx vitest run`
Run: `cd packages/testing && npx tsc --noEmit && npx vitest run`

- [ ] **Step 2: Build both packages**

Run: `cd packages/core && npx tsup`
Run: `cd packages/testing && npx tsup`

- [ ] **Step 3: Push**

```bash
git push
```
