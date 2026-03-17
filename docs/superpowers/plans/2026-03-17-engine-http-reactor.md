# Engine, HTTP, and Reactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three subpath exports to `@rytejs/core` — `core/engine` (load-dispatch-save lifecycle), `core/http` (Fetch API handler), and `core/reactor` (event-to-command mapping).

**Architecture:** The engine wraps core's pure `dispatch()` with persistence via a `StoreAdapter` interface, in-process locking, and optimistic concurrency. The HTTP handler binds the engine to a standard `(Request) => Promise<Response>`. The reactor provides type-safe event-to-command mapping with no execution logic. All three are subpath exports — no new packages.

**Tech Stack:** TypeScript, Zod v4, Vitest, tsup, Biome (tabs, 100-char width)

**Spec:** `docs/superpowers/specs/2026-03-16-engine-http-reactor-design.md`

**Deferred from spec:** `toExpress()` adapter — Express usage requires a shim that converts `(req, res)` to `(Request) => Response`. This is trivial but introduces a Node.js-specific dependency (`node:http`). Deferring to avoid polluting the universal fetch handler. Can be added as a follow-up task.

---

## File Structure

### New files to create

```
packages/core/src/
├── engine/
│   ├── index.ts            — barrel exports for @rytejs/core/engine
│   ├── types.ts            — StoreAdapter, StoredWorkflow, EmittedEvent, SaveOptions, EngineOptions, ExecutionResult
│   ├── errors.ts           — ConcurrencyConflictError, WorkflowAlreadyExistsError, WorkflowNotFoundError, RouterNotFoundError, RestoreError
│   ├── lock.ts             — withLock() in-process promise-chain lock
│   ├── memory-store.ts     — memoryStore() StoreAdapter for testing
│   └── engine.ts           — ExecutionEngine class + createEngine factory
├── reactor/
│   ├── index.ts            — barrel exports for @rytejs/core/reactor
│   ├── types.ts            — ReactorCommand, ReactorContext
│   └── reactors.ts         — Reactors class + createReactors factory
└── http/
    ├── index.ts            — barrel exports for @rytejs/core/http
    ├── types.ts            — HttpHandlerOptions
    └── handler.ts          — createHandler()

packages/core/__tests__/
├── engine/
│   ├── errors.test.ts
│   ├── lock.test.ts
│   ├── memory-store.test.ts
│   └── engine.test.ts
├── reactor/
│   └── reactors.test.ts
└── http/
    └── handler.test.ts
```

### Files to modify

```
packages/core/src/router.ts         — make definition public
packages/core/src/types.ts          — add ConfigOf utility type
packages/core/src/index.ts          — re-export ConfigOf
packages/core/package.json          — add subpath exports
packages/core/tsup.config.ts        — add entry points
```

### Type cast convention

The engine holds a heterogeneous router map (`Record<string, WorkflowRouter<WorkflowConfig>>`). When calling `definition.createWorkflow()` or `router.dispatch()`, the specific `TConfig` is erased to the base `WorkflowConfig`. This requires `as never` casts at the engine boundary. These casts are safe because:
- `createWorkflow` validates data against Zod schemas at runtime
- `dispatch` validates commands against Zod schemas at runtime
- The type system guarantees correctness for direct consumers; the engine trades compile-time narrowing for runtime validation

---

## Chunk 1: Core Prerequisites + Engine Types

### Task 1: Make `WorkflowRouter.definition` public

**Files:**
- Modify: `packages/core/src/router.ts` (constructor, `private` → `public`)
- Modify: `packages/core/__tests__/router.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/__tests__/router.test.ts`, add to the existing `describe("WorkflowRouter")` block:

```ts
test("exposes definition as a public readonly property", () => {
	const router = new WorkflowRouter(testWorkflow);
	expect(router.definition).toBe(testWorkflow);
	expect(router.definition.name).toBe("test");
});
```

Use whatever `testWorkflow` definition already exists in that test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/router.test.ts -t "exposes definition"`
Expected: FAIL — `definition` is private

- [ ] **Step 3: Change `private` to `public` on `definition`**

In `packages/core/src/router.ts`, in the constructor, change:
```ts
private readonly definition: WorkflowDefinition<TConfig>,
```
to:
```ts
public readonly definition: WorkflowDefinition<TConfig>,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rytejs/core vitest run __tests__/router.test.ts -t "exposes definition"`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All 149+ tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/router.ts packages/core/__tests__/router.test.ts
git commit -m "feat: make WorkflowRouter.definition public readonly"
```

---

### Task 2: Add `ConfigOf` utility type

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add `ConfigOf` to types.ts**

At the end of the type helpers section in `packages/core/src/types.ts` (after the existing `ErrorData` type), add:

```ts
/** Extracts the WorkflowConfig type from a WorkflowRouter instance. */
export type ConfigOf<R> = R extends import("./router.js").WorkflowRouter<infer C, unknown>
	? C
	: never;
```

Use `import()` type to avoid circular import — `types.ts` should not have a top-level import from `router.ts`.

- [ ] **Step 2: Re-export from index.ts**

Add `ConfigOf` to the type exports from `"./types.js"` in `packages/core/src/index.ts`.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat: add ConfigOf<R> utility type"
```

---

### Task 3: Add subpath exports to package.json and tsup config

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsup.config.ts`

Note: After this task, `pnpm run check` and `npx tsup` will fail until all barrel export files are created (Tasks 9, 12, 14). This is expected.

- [ ] **Step 1: Update tsup.config.ts**

Change the `entry` array to include the new subpath entry points:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/engine/index.ts",
		"src/reactor/index.ts",
		"src/http/index.ts",
	],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

- [ ] **Step 2: Update package.json exports**

Add subpath exports to `packages/core/package.json`. Preserve the existing root export and add three new ones:

```jsonc
{
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js",
			"require": "./dist/index.cjs"
		},
		"./engine": {
			"types": "./dist/engine/index.d.ts",
			"import": "./dist/engine/index.js",
			"require": "./dist/engine/index.cjs"
		},
		"./reactor": {
			"types": "./dist/reactor/index.d.ts",
			"import": "./dist/reactor/index.js",
			"require": "./dist/reactor/index.cjs"
		},
		"./http": {
			"types": "./dist/http/index.d.ts",
			"import": "./dist/http/index.js",
			"require": "./dist/http/index.cjs"
		}
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json packages/core/tsup.config.ts
git commit -m "chore: add subpath export config for engine, reactor, http"
```

---

### Task 4: Engine error types

**Files:**
- Create: `packages/core/src/engine/errors.ts`
- Create: `packages/core/__tests__/engine/errors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/engine/errors.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ValidationError } from "../../src/types.js";
import {
	ConcurrencyConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "../../src/engine/errors.js";

describe("engine errors", () => {
	test("ConcurrencyConflictError has correct fields", () => {
		const err = new ConcurrencyConflictError("wf-1", 2, 3);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("ConcurrencyConflictError");
		expect(err.workflowId).toBe("wf-1");
		expect(err.expectedVersion).toBe(2);
		expect(err.actualVersion).toBe(3);
		expect(err.message).toContain("wf-1");
	});

	test("WorkflowAlreadyExistsError has correct fields", () => {
		const err = new WorkflowAlreadyExistsError("wf-1");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("WorkflowAlreadyExistsError");
		expect(err.workflowId).toBe("wf-1");
	});

	test("WorkflowNotFoundError has correct fields", () => {
		const err = new WorkflowNotFoundError("wf-1");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("WorkflowNotFoundError");
		expect(err.workflowId).toBe("wf-1");
	});

	test("RouterNotFoundError has correct fields", () => {
		const err = new RouterNotFoundError("orders");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("RouterNotFoundError");
		expect(err.routerName).toBe("orders");
	});

	test("RestoreError has correct fields", () => {
		const validationError = new ValidationError("restore", []);
		const err = new RestoreError("wf-1", validationError);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("RestoreError");
		expect(err.workflowId).toBe("wf-1");
		expect(err.validationError).toBe(validationError);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/errors.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement error classes**

Create `packages/core/src/engine/errors.ts`:

```ts
import type { ValidationError } from "../types.js";

export class ConcurrencyConflictError extends Error {
	readonly name = "ConcurrencyConflictError";

	constructor(
		readonly workflowId: string,
		readonly expectedVersion: number,
		readonly actualVersion: number,
	) {
		super(
			`Concurrency conflict for workflow "${workflowId}": expected version ${expectedVersion}, actual ${actualVersion}`,
		);
	}
}

export class WorkflowAlreadyExistsError extends Error {
	readonly name = "WorkflowAlreadyExistsError";

	constructor(readonly workflowId: string) {
		super(`Workflow "${workflowId}" already exists`);
	}
}

export class WorkflowNotFoundError extends Error {
	readonly name = "WorkflowNotFoundError";

	constructor(readonly workflowId: string) {
		super(`Workflow "${workflowId}" not found`);
	}
}

export class RouterNotFoundError extends Error {
	readonly name = "RouterNotFoundError";

	constructor(readonly routerName: string) {
		super(`Router "${routerName}" not found`);
	}
}

export class RestoreError extends Error {
	readonly name = "RestoreError";

	constructor(
		readonly workflowId: string,
		readonly validationError: ValidationError,
	) {
		super(`Failed to restore workflow "${workflowId}": ${validationError.message}`);
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/errors.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/errors.ts packages/core/__tests__/engine/errors.test.ts
git commit -m "feat(engine): add error types"
```

---

### Task 5: Engine type definitions

**Files:**
- Create: `packages/core/src/engine/types.ts`

- [ ] **Step 1: Create type definitions**

Create `packages/core/src/engine/types.ts`:

```ts
import type { DispatchResult, WorkflowConfig } from "../types.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { WorkflowRouter } from "../router.js";

export interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface EmittedEvent {
	type: string;
	data: unknown;
}

export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	events: EmittedEvent[];
	expectedVersion: number;
}

export interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}

export interface EngineOptions {
	store: StoreAdapter;
	routers: Record<string, WorkflowRouter<WorkflowConfig>>;
	lockTimeout?: number;
}

export interface ExecutionResult {
	result: DispatchResult<WorkflowConfig>;
	events: EmittedEvent[];
	version: number;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/engine/types.ts
git commit -m "feat(engine): add type definitions"
```

---

### Task 6: In-process lock

**Files:**
- Create: `packages/core/src/engine/lock.ts`
- Create: `packages/core/__tests__/engine/lock.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/engine/lock.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { withLock } from "../../src/engine/lock.js";

describe("withLock", () => {
	test("executes function and returns result", async () => {
		const result = await withLock("wf-1", () => Promise.resolve(42), 5000);
		expect(result).toBe(42);
	});

	test("serializes concurrent calls for the same ID", async () => {
		const order: number[] = [];
		const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const p1 = withLock(
			"wf-1",
			async () => {
				order.push(1);
				await delay(50);
				order.push(2);
			},
			5000,
		);

		const p2 = withLock(
			"wf-1",
			async () => {
				order.push(3);
				await delay(10);
				order.push(4);
			},
			5000,
		);

		await Promise.all([p1, p2]);
		expect(order).toEqual([1, 2, 3, 4]);
	});

	test("allows parallel calls for different IDs", async () => {
		const order: string[] = [];
		const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const p1 = withLock(
			"wf-1",
			async () => {
				order.push("a-start");
				await delay(50);
				order.push("a-end");
			},
			5000,
		);

		const p2 = withLock(
			"wf-2",
			async () => {
				order.push("b-start");
				await delay(10);
				order.push("b-end");
			},
			5000,
		);

		await Promise.all([p1, p2]);
		expect(order[0]).toBe("a-start");
		expect(order[1]).toBe("b-start");
	});

	test("releases lock if function throws", async () => {
		await expect(
			withLock("wf-1", () => Promise.reject(new Error("boom")), 5000),
		).rejects.toThrow("boom");

		const result = await withLock("wf-1", () => Promise.resolve("ok"), 5000);
		expect(result).toBe("ok");
	});

	test("rejects with timeout if lock is held too long", async () => {
		const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const p1 = withLock("wf-1", () => delay(200), 5000);
		const p2 = withLock("wf-1", () => Promise.resolve("done"), 50);

		await expect(p2).rejects.toThrow("Lock timeout");
		await p1;
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/lock.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement withLock**

Create `packages/core/src/engine/lock.ts`:

```ts
const locks = new Map<string, Promise<void>>();

export async function withLock<T>(
	id: string,
	fn: () => Promise<T>,
	timeout: number,
): Promise<T> {
	const prev = locks.get(id) ?? Promise.resolve();
	let resolve: () => void;
	const gate = new Promise<void>((r) => {
		resolve = r;
	});
	locks.set(id, gate);

	await Promise.race([
		prev,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Lock timeout for ${id}`)), timeout),
		),
	]);

	try {
		return await fn();
	} finally {
		resolve!();
		if (locks.get(id) === gate) locks.delete(id);
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/lock.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/lock.ts packages/core/__tests__/engine/lock.test.ts
git commit -m "feat(engine): add in-process per-workflow lock"
```

---

## Chunk 2: Memory Store + ExecutionEngine

### Task 7: Memory store

**Files:**
- Create: `packages/core/src/engine/memory-store.ts`
- Create: `packages/core/__tests__/engine/memory-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/engine/memory-store.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { memoryStore } from "../../src/engine/memory-store.js";
import { ConcurrencyConflictError } from "../../src/engine/errors.js";

const makeSnapshot = (id: string, state = "Draft") => ({
	id,
	definitionName: "test",
	state,
	data: { title: "hello" },
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	modelVersion: 1,
});

describe("memoryStore", () => {
	test("load returns null for unknown workflow", async () => {
		const store = memoryStore();
		expect(await store.load("unknown")).toBeNull();
	});

	test("save with expectedVersion 0 creates a new record", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 });

		const stored = await store.load("wf-1");
		expect(stored).not.toBeNull();
		expect(stored!.snapshot).toEqual(snapshot);
		expect(stored!.version).toBe(1);
	});

	test("save increments version on each call", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 });
		await store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 1 });

		const stored = await store.load("wf-1");
		expect(stored!.version).toBe(2);
	});

	test("save throws ConcurrencyConflictError on version mismatch", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 });

		await expect(
			store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 }),
		).rejects.toThrow(ConcurrencyConflictError);
	});

	test("save with expectedVersion 0 throws if record already exists", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 });

		await expect(
			store.save({ id: "wf-1", snapshot, events: [], expectedVersion: 0 }),
		).rejects.toThrow(ConcurrencyConflictError);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement memoryStore**

Create `packages/core/src/engine/memory-store.ts`:

```ts
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "./types.js";
import { ConcurrencyConflictError } from "./errors.js";

export function memoryStore(): StoreAdapter {
	const data = new Map<string, StoredWorkflow>();

	return {
		async load(id) {
			return data.get(id) ?? null;
		},

		async save(options: SaveOptions) {
			const { id, snapshot, expectedVersion } = options;
			const existing = data.get(id);
			const currentVersion = existing?.version ?? 0;

			if (currentVersion !== expectedVersion) {
				throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
			}

			data.set(id, { snapshot, version: currentVersion + 1 });
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/memory-store.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/memory-store.ts packages/core/__tests__/engine/memory-store.test.ts
git commit -m "feat(engine): add in-memory StoreAdapter"
```

---

### Task 8: ExecutionEngine

**Files:**
- Create: `packages/core/src/engine/engine.ts`
- Create: `packages/core/__tests__/engine/engine.test.ts`

- [ ] **Step 1: Write all engine tests**

Create `packages/core/__tests__/engine/engine.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { WorkflowRouter } from "../../src/router.js";
import { createEngine } from "../../src/engine/engine.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import {
	ConcurrencyConflictError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "../../src/engine/errors.js";
import type { StoreAdapter } from "../../src/engine/types.js";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Complete: z.object({}),
		Fail: z.object({ reason: z.string() }),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		AlreadyDone: z.object({}),
	},
});

const taskRouter = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", { title: data.title, completedAt: new Date() });
			emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
		});
	})
	.state("Done", ({ on }) => {
		on("Complete", ({ error }) => {
			error({ code: "AlreadyDone", data: {} });
		});
	});

function setup() {
	const store = memoryStore();
	const engine = createEngine({ store, routers: { tasks: taskRouter } });
	return { store, engine };
}

describe("ExecutionEngine", () => {
	describe("create", () => {
		test("creates a new workflow and persists it", async () => {
			const { engine, store } = setup();
			const result = await engine.create("tasks", "task-1", {
				initialState: "Todo",
				data: { title: "Write tests" },
			});

			expect(result.version).toBe(1);
			expect(result.workflow.state).toBe("Todo");
			expect(result.workflow.id).toBe("task-1");

			const stored = await store.load("task-1");
			expect(stored).not.toBeNull();
			expect(stored!.version).toBe(1);
		});

		test("throws WorkflowAlreadyExistsError for duplicate ID", async () => {
			const { engine } = setup();
			await engine.create("tasks", "task-1", {
				initialState: "Todo",
				data: { title: "First" },
			});

			await expect(
				engine.create("tasks", "task-1", {
					initialState: "Todo",
					data: { title: "Second" },
				}),
			).rejects.toThrow(WorkflowAlreadyExistsError);
		});

		test("throws RouterNotFoundError for unknown router", async () => {
			const { engine } = setup();
			await expect(
				engine.create("unknown", "task-1", {
					initialState: "Todo",
					data: { title: "Test" },
				}),
			).rejects.toThrow(RouterNotFoundError);
		});
	});

	describe("execute", () => {
		test("dispatches command and persists result", async () => {
			const { engine } = setup();
			await engine.create("tasks", "task-1", {
				initialState: "Todo",
				data: { title: "Write tests" },
			});

			const { result, events, version } = await engine.execute("tasks", "task-1", {
				type: "Complete",
				payload: {},
			});

			expect(result.ok).toBe(true);
			expect(version).toBe(2);
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("TaskCompleted");
		});

		test("does not persist on failed dispatch and returns current version", async () => {
			const { engine, store } = setup();
			await engine.create("tasks", "task-1", {
				initialState: "Done",
				data: { title: "Already done", completedAt: new Date() },
			});

			const { result, version } = await engine.execute("tasks", "task-1", {
				type: "Complete",
				payload: {},
			});

			expect(result.ok).toBe(false);
			expect(version).toBe(1);
			const stored = await store.load("task-1");
			expect(stored!.version).toBe(1);
		});

		test("returns domain error with correct category", async () => {
			const { engine } = setup();
			await engine.create("tasks", "task-1", {
				initialState: "Done",
				data: { title: "Done", completedAt: new Date() },
			});

			const { result } = await engine.execute("tasks", "task-1", {
				type: "Complete",
				payload: {},
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.category).toBe("domain");
			}
		});

		test("throws WorkflowNotFoundError for missing workflow", async () => {
			const { engine } = setup();
			await expect(
				engine.execute("tasks", "missing", { type: "Complete", payload: {} }),
			).rejects.toThrow(WorkflowNotFoundError);
		});

		test("throws RouterNotFoundError for unknown router", async () => {
			const { engine } = setup();
			await expect(
				engine.execute("unknown", "task-1", { type: "Complete", payload: {} }),
			).rejects.toThrow(RouterNotFoundError);
		});

		test("throws ConcurrencyConflictError on version mismatch", async () => {
			// Use a store that simulates a concurrent write
			const conflictStore: StoreAdapter = {
				async load() {
					return {
						snapshot: {
							id: "task-1",
							definitionName: "task",
							state: "Todo",
							data: { title: "Test" },
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							modelVersion: 1,
						},
						version: 1,
					};
				},
				async save() {
					throw new ConcurrencyConflictError("task-1", 1, 2);
				},
			};
			const engine = createEngine({ store: conflictStore, routers: { tasks: taskRouter } });

			await expect(
				engine.execute("tasks", "task-1", { type: "Complete", payload: {} }),
			).rejects.toThrow(ConcurrencyConflictError);
		});
	});

	describe("load", () => {
		test("returns stored workflow", async () => {
			const { engine } = setup();
			await engine.create("tasks", "task-1", {
				initialState: "Todo",
				data: { title: "Test" },
			});

			const stored = await engine.load("task-1");
			expect(stored).not.toBeNull();
			expect(stored!.snapshot.id).toBe("task-1");
		});

		test("returns null for unknown ID", async () => {
			const { engine } = setup();
			expect(await engine.load("missing")).toBeNull();
		});
	});

	describe("getRouter", () => {
		test("returns registered router", () => {
			const { engine } = setup();
			expect(engine.getRouter("tasks")).toBe(taskRouter);
		});

		test("throws RouterNotFoundError for unknown name", () => {
			const { engine } = setup();
			expect(() => engine.getRouter("unknown")).toThrow(RouterNotFoundError);
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ExecutionEngine**

Create `packages/core/src/engine/engine.ts`:

```ts
import type { WorkflowConfig } from "../types.js";
import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { EngineOptions, ExecutionResult, StoreAdapter, StoredWorkflow } from "./types.js";
import {
	ConcurrencyConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "./errors.js";
import { withLock } from "./lock.js";

const DEFAULT_LOCK_TIMEOUT = 30_000;

export class ExecutionEngine {
	private readonly store: StoreAdapter;
	private readonly routers: Record<string, WorkflowRouter<WorkflowConfig>>;
	private readonly lockTimeout: number;

	constructor(options: EngineOptions) {
		this.store = options.store;
		this.routers = options.routers;
		this.lockTimeout = options.lockTimeout ?? DEFAULT_LOCK_TIMEOUT;
	}

	getRouter(name: string): WorkflowRouter<WorkflowConfig> {
		const router = this.routers[name];
		if (!router) throw new RouterNotFoundError(name);
		return router;
	}

	async load(id: string): Promise<StoredWorkflow | null> {
		return this.store.load(id);
	}

	async create(
		routerName: string,
		id: string,
		init: { initialState: string; data: unknown },
	): Promise<{ workflow: WorkflowSnapshot; version: number }> {
		const router = this.getRouter(routerName);
		const definition = router.definition;

		return withLock(
			id,
			async () => {
				const existing = await this.store.load(id);
				if (existing) throw new WorkflowAlreadyExistsError(id);

				// as never: type erasure — the engine holds WorkflowConfig base type,
				// but createWorkflow validates data against Zod schemas at runtime
				const workflow = definition.createWorkflow(id, init as never);
				const snapshot = definition.snapshot(workflow);

				try {
					await this.store.save({
						id,
						snapshot,
						events: [],
						expectedVersion: 0,
					});
				} catch (err) {
					if (err instanceof ConcurrencyConflictError) {
						throw new WorkflowAlreadyExistsError(id);
					}
					throw err;
				}

				return { workflow: snapshot, version: 1 };
			},
			this.lockTimeout,
		);
	}

	async execute(
		routerName: string,
		id: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult> {
		const router = this.getRouter(routerName);
		const definition = router.definition;

		return withLock(
			id,
			async () => {
				const stored = await this.store.load(id);
				if (!stored) throw new WorkflowNotFoundError(id);

				const restoreResult = definition.restore(stored.snapshot);
				if (!restoreResult.ok) {
					throw new RestoreError(id, restoreResult.error);
				}

				// as never: type erasure — the engine holds WorkflowConfig base type,
				// but dispatch validates commands against Zod schemas at runtime
				const result = await router.dispatch(
					restoreResult.workflow,
					command as never,
				);

				if (!result.ok) {
					return { result, events: [], version: stored.version };
				}

				const newSnapshot = definition.snapshot(result.workflow);
				const events = result.events.map((e) => ({
					type: e.type as string,
					data: e.data,
				}));

				await this.store.save({
					id,
					snapshot: newSnapshot,
					events,
					expectedVersion: stored.version,
				});

				return { result, events, version: stored.version + 1 };
			},
			this.lockTimeout,
		);
	}
}

export function createEngine(options: EngineOptions): ExecutionEngine {
	return new ExecutionEngine(options);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/engine/`
Expected: All engine tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/engine.ts packages/core/__tests__/engine/engine.test.ts
git commit -m "feat(engine): implement ExecutionEngine with create, execute, load"
```

---

### Task 9: Engine barrel exports

**Files:**
- Create: `packages/core/src/engine/index.ts`

- [ ] **Step 1: Create barrel export**

Create `packages/core/src/engine/index.ts`:

```ts
export { createEngine, ExecutionEngine } from "./engine.js";
export {
	ConcurrencyConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "./errors.js";
export { memoryStore } from "./memory-store.js";
export type {
	EmittedEvent,
	EngineOptions,
	ExecutionResult,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
} from "./types.js";
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/engine/index.ts
git commit -m "feat(engine): add barrel exports"
```

---

## Chunk 3: Reactor

### Task 10: Reactor types

**Files:**
- Create: `packages/core/src/reactor/types.ts`

- [ ] **Step 1: Create type definitions**

Create `packages/core/src/reactor/types.ts`:

```ts
import type { EventData, EventNames, WorkflowConfig } from "../types.js";

export interface ReactorCommand {
	workflowId: string;
	routerName: string;
	command: { type: string; payload: unknown };
}

export interface ReactorContext<
	TConfig extends WorkflowConfig,
	TEvent extends EventNames<TConfig>,
> {
	event: { type: TEvent; data: EventData<TConfig, TEvent> };
	workflowId: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/reactor/types.ts
git commit -m "feat(reactor): add type definitions"
```

---

### Task 11: Reactors class

**Files:**
- Create: `packages/core/src/reactor/reactors.ts`
- Create: `packages/core/__tests__/reactor/reactors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/__tests__/reactor/reactors.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { WorkflowRouter } from "../../src/router.js";
import { createReactors } from "../../src/reactor/reactors.js";

const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.string().array() }),
		Placed: z.object({ items: z.string().array(), placedAt: z.coerce.date() }),
	},
	commands: {
		Place: z.object({}),
	},
	events: {
		OrderPlaced: z.object({ orderId: z.string(), shipmentId: z.string() }),
		InventoryReserved: z.object({ orderId: z.string() }),
	},
	errors: {},
});

const orderRouter = new WorkflowRouter(orderWorkflow);

describe("Reactors", () => {
	test("resolve returns empty array when no reactors match", () => {
		const reactors = createReactors();
		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);
		expect(commands).toEqual([]);
	});

	test("resolve returns command for matching event", () => {
		const reactors = createReactors().on(
			orderRouter,
			"OrderPlaced",
			({ event }) => ({
				workflowId: event.data.shipmentId,
				routerName: "shipments",
				command: { type: "Prepare", payload: { orderId: event.data.orderId } },
			}),
		);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(commands).toHaveLength(1);
		expect(commands[0].workflowId).toBe("ship-1");
		expect(commands[0].routerName).toBe("shipments");
		expect(commands[0].command.type).toBe("Prepare");
	});

	test("resolve handles multiple events", () => {
		const reactors = createReactors()
			.on(orderRouter, "OrderPlaced", ({ event }) => ({
				workflowId: event.data.shipmentId,
				routerName: "shipments",
				command: { type: "Prepare", payload: {} },
			}))
			.on(orderRouter, "InventoryReserved", ({ event }) => ({
				workflowId: event.data.orderId,
				routerName: "warehouse",
				command: { type: "Pick", payload: {} },
			}));

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
			{ type: "InventoryReserved", data: { orderId: "order-1" } },
		]);

		expect(commands).toHaveLength(2);
		expect(commands[0].routerName).toBe("shipments");
		expect(commands[1].routerName).toBe("warehouse");
	});

	test("resolve handles handler returning array", () => {
		const reactors = createReactors().on(
			orderRouter,
			"OrderPlaced",
			({ event }) => [
				{
					workflowId: event.data.shipmentId,
					routerName: "shipments",
					command: { type: "Prepare", payload: {} },
				},
				{
					workflowId: event.data.orderId,
					routerName: "notifications",
					command: { type: "Send", payload: {} },
				},
			],
		);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(commands).toHaveLength(2);
	});

	test("resolve handles handler returning null", () => {
		const reactors = createReactors().on(orderRouter, "OrderPlaced", () => null);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(commands).toEqual([]);
	});

	test("resolve ignores events from different routers", () => {
		const otherWorkflow = defineWorkflow("other", {
			states: { Init: z.object({}) },
			commands: {},
			events: { OrderPlaced: z.object({ id: z.string() }) },
			errors: {},
		});
		const otherRouter = new WorkflowRouter(otherWorkflow);

		const reactors = createReactors().on(orderRouter, "OrderPlaced", () => ({
			workflowId: "x",
			routerName: "y",
			command: { type: "Z", payload: {} },
		}));

		const commands = reactors.resolve(otherRouter, "other-1", [
			{ type: "OrderPlaced", data: { id: "1" } },
		]);

		expect(commands).toEqual([]);
	});

	test("on() is chainable", () => {
		const reactors = createReactors();
		const result = reactors.on(orderRouter, "OrderPlaced", () => null);
		expect(result).toBe(reactors);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/reactor/reactors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Reactors class**

Create `packages/core/src/reactor/reactors.ts`. Note: the reactor does NOT import from `../engine/` — it defines its own inline event type to avoid a cross-module dependency. The `resolve()` method accepts `Array<{ type: string; data: unknown }>` which is structurally compatible with `EmittedEvent` from the engine.

```ts
import type { EventNames, WorkflowConfig } from "../types.js";
import type { WorkflowRouter } from "../router.js";
import type { ReactorCommand, ReactorContext } from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: internal type erasure for heterogeneous handler storage
type AnyHandler = (ctx: { event: { type: string; data: any }; workflowId: string }) =>
	ReactorCommand | ReactorCommand[] | null;

interface Registration {
	definitionName: string;
	eventType: string;
	handler: AnyHandler;
}

export class Reactors {
	private readonly registrations: Registration[] = [];

	on<TConfig extends WorkflowConfig, TEvent extends EventNames<TConfig>>(
		router: WorkflowRouter<TConfig>,
		event: TEvent,
		handler: (
			ctx: ReactorContext<TConfig, TEvent>,
		) => ReactorCommand | ReactorCommand[] | null,
	): this {
		this.registrations.push({
			definitionName: router.definition.name,
			eventType: event as string,
			handler: handler as AnyHandler,
		});
		return this;
	}

	resolve<TConfig extends WorkflowConfig>(
		router: WorkflowRouter<TConfig>,
		workflowId: string,
		events: Array<{ type: string; data: unknown }>,
	): ReactorCommand[] {
		const definitionName = router.definition.name;
		const commands: ReactorCommand[] = [];

		for (const event of events) {
			for (const reg of this.registrations) {
				if (reg.definitionName !== definitionName) continue;
				if (reg.eventType !== event.type) continue;

				const result = reg.handler({
					event: { type: event.type, data: event.data },
					workflowId,
				});

				if (result === null) continue;
				if (Array.isArray(result)) {
					commands.push(...result);
				} else {
					commands.push(result);
				}
			}
		}

		return commands;
	}
}

export function createReactors(): Reactors {
	return new Reactors();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/reactor/reactors.test.ts`
Expected: All 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reactor/reactors.ts packages/core/__tests__/reactor/reactors.test.ts
git commit -m "feat(reactor): implement Reactors with on() and resolve()"
```

---

### Task 12: Reactor barrel exports

**Files:**
- Create: `packages/core/src/reactor/index.ts`

- [ ] **Step 1: Create barrel export**

Create `packages/core/src/reactor/index.ts`:

```ts
export { createReactors, Reactors } from "./reactors.js";
export type { ReactorCommand, ReactorContext } from "./types.js";
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/reactor/index.ts
git commit -m "feat(reactor): add barrel exports"
```

---

## Chunk 4: HTTP Handler

### Task 13: HTTP handler

**Files:**
- Create: `packages/core/src/http/types.ts`
- Create: `packages/core/src/http/handler.ts`
- Create: `packages/core/__tests__/http/handler.test.ts`

- [ ] **Step 1: Create types**

Create `packages/core/src/http/types.ts`:

```ts
import type { ExecutionEngine } from "../engine/engine.js";

export interface HttpHandlerOptions {
	engine: ExecutionEngine;
	basePath?: string;
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/core/__tests__/http/handler.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { WorkflowRouter } from "../../src/router.js";
import { createEngine } from "../../src/engine/engine.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import { createHandler } from "../../src/http/handler.js";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Complete: z.object({}),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotReady: z.object({ reason: z.string() }),
	},
});

const taskRouter = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", { title: data.title, completedAt: new Date() });
			emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
		});
	})
	.state("Done", ({ on }) => {
		on("Complete", ({ error }) => {
			error({ code: "NotReady", data: { reason: "Already done" } });
		});
	});

function setup() {
	const store = memoryStore();
	const engine = createEngine({ store, routers: { tasks: taskRouter } });
	const handler = createHandler({ engine });
	return { handler, engine };
}

function jsonRequest(method: string, path: string, body?: unknown): Request {
	const init: RequestInit = {
		method,
		headers: { "Content-Type": "application/json" },
	};
	if (body !== undefined) init.body = JSON.stringify(body);
	return new Request(`http://localhost${path}`, init);
}

describe("createHandler", () => {
	describe("PUT /:name/:id (create)", () => {
		test("creates a workflow and returns 201", async () => {
			const { handler } = setup();
			const res = await handler(
				jsonRequest("PUT", "/tasks/task-1", {
					initialState: "Todo",
					data: { title: "Write tests" },
				}),
			);
			const body = await res.json();

			expect(res.status).toBe(201);
			expect(body.ok).toBe(true);
			expect(body.workflow.id).toBe("task-1");
			expect(body.workflow.state).toBe("Todo");
			expect(body.version).toBe(1);
		});

		test("returns 409 for duplicate workflow", async () => {
			const { handler } = setup();
			const req = () =>
				jsonRequest("PUT", "/tasks/task-1", {
					initialState: "Todo",
					data: { title: "Test" },
				});
			await handler(req());
			const res = await handler(req());

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.ok).toBe(false);
			expect(body.error.category).toBe("conflict");
		});

		test("returns 404 for unknown router", async () => {
			const { handler } = setup();
			const res = await handler(
				jsonRequest("PUT", "/unknown/task-1", {
					initialState: "Todo",
					data: { title: "Test" },
				}),
			);
			expect(res.status).toBe(404);
		});

		test("returns 400 for missing initialState", async () => {
			const { handler } = setup();
			const res = await handler(
				jsonRequest("PUT", "/tasks/task-1", { data: { title: "Test" } }),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("POST /:name/:id (dispatch)", () => {
		test("dispatches command and returns 200", async () => {
			const { handler } = setup();
			await handler(
				jsonRequest("PUT", "/tasks/task-1", {
					initialState: "Todo",
					data: { title: "Write tests" },
				}),
			);

			const res = await handler(
				jsonRequest("POST", "/tasks/task-1", {
					type: "Complete",
					payload: {},
				}),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.events).toHaveLength(1);
			expect(body.events[0].type).toBe("TaskCompleted");
			expect(body.version).toBe(2);
		});

		test("returns 404 for missing workflow", async () => {
			const { handler } = setup();
			const res = await handler(
				jsonRequest("POST", "/tasks/missing", {
					type: "Complete",
					payload: {},
				}),
			);
			expect(res.status).toBe(404);
		});

		test("returns 400 for router errors (unknown command)", async () => {
			const { handler } = setup();
			await handler(
				jsonRequest("PUT", "/tasks/task-1", {
					initialState: "Todo",
					data: { title: "Test" },
				}),
			);

			const res = await handler(
				jsonRequest("POST", "/tasks/task-1", {
					type: "NonexistentCommand",
					payload: {},
				}),
			);
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.ok).toBe(false);
		});

		test("returns 422 for domain errors", async () => {
			const { handler } = setup();
			await handler(
				jsonRequest("PUT", "/tasks/task-1", {
					initialState: "Done",
					data: { title: "Done", completedAt: new Date().toISOString() },
				}),
			);

			const res = await handler(
				jsonRequest("POST", "/tasks/task-1", {
					type: "Complete",
					payload: {},
				}),
			);
			expect(res.status).toBe(422);
			const body = await res.json();
			expect(body.ok).toBe(false);
			expect(body.error.category).toBe("domain");
			expect(body.error.code).toBe("NotReady");
		});

		test("returns 400 for missing command type", async () => {
			const { handler } = setup();
			const res = await handler(
				jsonRequest("POST", "/tasks/task-1", { payload: {} }),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /:name/:id (load)", () => {
		test("returns workflow state", async () => {
			const { handler } = setup();
			await handler(
				jsonRequest("PUT", "/tasks/task-1", {
					initialState: "Todo",
					data: { title: "Read" },
				}),
			);

			const res = await handler(new Request("http://localhost/tasks/task-1"));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.workflow.state).toBe("Todo");
			expect(body.version).toBe(1);
		});

		test("returns 404 for missing workflow", async () => {
			const { handler } = setup();
			const res = await handler(new Request("http://localhost/tasks/missing"));
			expect(res.status).toBe(404);
		});
	});

	describe("error handling", () => {
		test("returns 405 for unsupported methods", async () => {
			const { handler } = setup();
			const res = await handler(
				new Request("http://localhost/tasks/task-1", { method: "DELETE" }),
			);
			expect(res.status).toBe(405);
		});

		test("returns 400 for missing Content-Type on POST", async () => {
			const { handler } = setup();
			const res = await handler(
				new Request("http://localhost/tasks/task-1", {
					method: "POST",
					body: JSON.stringify({ type: "Complete", payload: {} }),
				}),
			);
			expect(res.status).toBe(400);
		});

		test("returns 400 for malformed JSON", async () => {
			const { handler } = setup();
			const res = await handler(
				new Request("http://localhost/tasks/task-1", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "not json",
				}),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("basePath", () => {
		test("strips basePath prefix", async () => {
			const store = memoryStore();
			const engine = createEngine({ store, routers: { tasks: taskRouter } });
			const handler = createHandler({ engine, basePath: "/workflows" });

			const res = await handler(
				jsonRequest("PUT", "/workflows/tasks/task-1", {
					initialState: "Todo",
					data: { title: "Test" },
				}),
			);
			expect(res.status).toBe(201);
		});
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/http/handler.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement createHandler**

Create `packages/core/src/http/handler.ts`:

```ts
import {
	ConcurrencyConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "../engine/errors.js";
import type { HttpHandlerOptions } from "./types.js";

function json(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function errorResponse(category: string, message: string, status: number): Response {
	return json({ ok: false, error: { category, message } }, status);
}

function parsePath(
	url: URL,
	basePath: string,
): { name: string; id: string } | null {
	let pathname = url.pathname;
	if (basePath !== "/" && pathname.startsWith(basePath)) {
		pathname = pathname.slice(basePath.length);
	}
	if (pathname.startsWith("/")) pathname = pathname.slice(1);
	const parts = pathname.split("/");
	if (parts.length < 2 || !parts[0] || !parts[1]) return null;
	return { name: parts[0], id: parts.slice(1).join("/") };
}

export function createHandler(
	options: HttpHandlerOptions,
): (request: Request) => Promise<Response> {
	const { engine, basePath = "/" } = options;

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const parsed = parsePath(url, basePath);
		if (!parsed) return errorResponse("not_found", "Invalid path", 404);
		const { name, id } = parsed;

		try {
			if (request.method === "GET") {
				const stored = await engine.load(id);
				if (!stored) {
					return errorResponse("not_found", `Workflow "${id}" not found`, 404);
				}
				return json(
					{ ok: true, workflow: stored.snapshot, version: stored.version },
					200,
				);
			}

			if (request.method === "PUT") {
				const contentType = request.headers.get("Content-Type") ?? "";
				if (!contentType.includes("application/json")) {
					return errorResponse(
						"validation",
						"Content-Type must be application/json",
						400,
					);
				}

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return errorResponse("validation", "Invalid JSON body", 400);
				}

				const { initialState, data } = body as Record<string, unknown>;
				if (typeof initialState !== "string") {
					return errorResponse(
						"validation",
						"Missing or invalid initialState",
						400,
					);
				}

				const result = await engine.create(name, id, { initialState, data });
				return json(
					{ ok: true, workflow: result.workflow, version: result.version },
					201,
				);
			}

			if (request.method === "POST") {
				const contentType = request.headers.get("Content-Type") ?? "";
				if (!contentType.includes("application/json")) {
					return errorResponse(
						"validation",
						"Content-Type must be application/json",
						400,
					);
				}

				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return errorResponse("validation", "Invalid JSON body", 400);
				}

				const { type, payload } = body as Record<string, unknown>;
				if (typeof type !== "string") {
					return errorResponse(
						"validation",
						"Missing or invalid command type",
						400,
					);
				}

				const { result, events, version } = await engine.execute(name, id, {
					type,
					payload,
				});

				if (!result.ok) {
					const { category } = result.error;
					const status =
						category === "domain"
							? 422
							: category === "validation"
								? 400
								: category === "router"
									? 400
									: category === "dependency"
										? 503
										: 500;
					return json({ ok: false, error: result.error }, status);
				}

				return json({ ok: true, workflow: result.workflow, events, version }, 200);
			}

			return errorResponse(
				"method_not_allowed",
				`Method ${request.method} not allowed`,
				405,
			);
		} catch (err) {
			if (err instanceof WorkflowNotFoundError) {
				return errorResponse("not_found", err.message, 404);
			}
			if (err instanceof RouterNotFoundError) {
				return errorResponse("not_found", err.message, 404);
			}
			if (err instanceof WorkflowAlreadyExistsError) {
				return errorResponse("conflict", err.message, 409);
			}
			if (err instanceof ConcurrencyConflictError) {
				return errorResponse("conflict", err.message, 409);
			}
			if (err instanceof RestoreError) {
				return errorResponse("unexpected", err.message, 500);
			}
			return errorResponse("unexpected", "Internal server error", 500);
		}
	};
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/http/handler.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/http/types.ts packages/core/src/http/handler.ts packages/core/__tests__/http/handler.test.ts
git commit -m "feat(http): implement Fetch API handler with error mapping"
```

---

### Task 14: HTTP barrel exports

**Files:**
- Create: `packages/core/src/http/index.ts`

- [ ] **Step 1: Create barrel export**

Create `packages/core/src/http/index.ts`:

```ts
export { createHandler } from "./handler.js";
export type { HttpHandlerOptions } from "./types.js";
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/http/index.ts
git commit -m "feat(http): add barrel exports"
```

---

## Chunk 5: Final Verification

### Task 15: Build and verify

- [ ] **Step 1: Build the package**

Run: `cd packages/core && npx tsup`
Expected: Build succeeds with 4 entry points, no errors

- [ ] **Step 2: Run full core test suite**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All tests pass (original 149+ tests plus ~30 new tests)

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `pnpm biome check packages/core/src/engine/ packages/core/src/reactor/ packages/core/src/http/`
Expected: No errors (or fix any auto-fixable issues with `pnpm biome check --fix`)

- [ ] **Step 5: Rebuild and verify testing package still compiles**

Run: `cd packages/core && npx tsup && pnpm --filter @rytejs/testing vitest run`
Expected: Testing package tests still pass with rebuilt core

- [ ] **Step 6: Commit any lint/format fixes**

```bash
git add -A
git commit -m "chore: lint fixes and final verification"
```

---

### Task 16: Push

- [ ] **Step 1: Push to remote**

```bash
git push
```
