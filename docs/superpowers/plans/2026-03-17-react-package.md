# @rytejs/react Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@rytejs/react` — a React integration package that exposes @rytejs/core workflows as reactive state management stores with a minimal API: `createWorkflowStore`, `createWorkflowContext`, and `useWorkflow`.

**Architecture:** External subscribable store wrapping `WorkflowRouter`, connected to React via `useSyncExternalStore`. A context factory (`createWorkflowContext`) provides a typed Provider + pre-bound hook. Selectors enable fine-grained re-render control. No external runtime dependencies.

**Tech Stack:** React 18+, TypeScript, Vitest, React Testing Library, tsup, Biome

**Spec:** `docs/superpowers/specs/2026-03-16-react-package-design.md`

---

## File Structure

```
packages/react/
├── src/
│   ├── index.ts                 # Public exports (3 runtime + 4 types)
│   ├── types.ts                 # WorkflowStore, WorkflowStoreSnapshot, WorkflowStoreOptions, UseWorkflowReturn
│   ├── store.ts                 # createWorkflowStore — subscribable store wrapping router
│   ├── use-workflow.ts          # useWorkflow — standalone hook (full + selector modes)
│   └── context.ts               # createWorkflowContext — typed Provider + pre-bound useWorkflow
├── __tests__/
│   ├── helpers.ts               # Shared test workflow definition + router factory
│   ├── store.test.ts            # Store unit tests (vanilla JS, no React)
│   ├── persistence.test.ts      # Persistence adapter tests (mock storage)
│   ├── use-workflow.test.ts     # Hook tests via renderHook (full + selector + match)
│   ├── context.test.ts          # Provider + context hook tests
│   └── types.test.ts            # Type-level tests (expectTypeOf)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

**Core change (prerequisite):**
- `packages/core/src/router.ts` — change `private readonly definition` to `readonly definition`

---

## Chunk 1: Foundation

### Task 1: Expose `WorkflowRouter.definition` as public

**Files:**
- Modify: `packages/core/src/router.ts` (line ~105)
- Create: `packages/core/__tests__/router-definition.test.ts`

- [ ] **Step 1: Write test for public definition access**

Create `packages/core/__tests__/router-definition.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { WorkflowRouter, defineWorkflow } from "../src/index.js";

describe("WorkflowRouter.definition", () => {
	test("exposes the definition as a public readonly property", () => {
		const definition = defineWorkflow("test", {
			states: { Idle: z.object({ value: z.number() }) },
			commands: { Inc: z.object({}) },
			events: {},
			errors: {},
		});
		const router = new WorkflowRouter(definition);

		expect(router.definition).toBe(definition);
		expect(router.definition.name).toBe("test");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rytejs/core vitest run __tests__/router-definition.test.ts`
Expected: FAIL — `Property 'definition' is private and only accessible within class 'WorkflowRouter'`

- [ ] **Step 3: Change `private` to `public` on definition property**

In `packages/core/src/router.ts`, change the constructor parameter:

```typescript
// Before:
constructor(
	private readonly definition: WorkflowDefinition<TConfig>,

// After:
constructor(
	readonly definition: WorkflowDefinition<TConfig>,
```

- [ ] **Step 4: Run all core tests**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All 175+ tests pass

- [ ] **Step 5: Rebuild core dist**

Run: `cd packages/core && pnpm tsup`
Expected: Build succeeds, dist/ updated

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/router.ts packages/core/__tests__/router-definition.test.ts
git commit -m "feat(core): expose WorkflowRouter.definition as public readonly"
git push
```

---

### Task 2: Scaffold `packages/react/`

**Files:**
- Create: `packages/react/package.json`
- Create: `packages/react/tsconfig.json`
- Create: `packages/react/tsup.config.ts`
- Create: `packages/react/vitest.config.ts`
- Create: `packages/react/src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
	"name": "@rytejs/react",
	"version": "0.6.0",
	"description": "React bindings for @rytejs/core — use workflows as reactive state stores",
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
	"files": [
		"dist"
	],
	"sideEffects": false,
	"repository": {
		"type": "git",
		"url": "https://github.com/helico-tech/rytejs",
		"directory": "packages/react"
	},
	"homepage": "https://helico-tech.github.io/rytejs",
	"bugs": "https://github.com/helico-tech/rytejs/issues",
	"keywords": [
		"workflow",
		"state-machine",
		"react",
		"hooks",
		"state-management"
	],
	"peerDependencies": {
		"@rytejs/core": "workspace:^",
		"react": ">=18"
	},
	"devDependencies": {
		"@rytejs/core": "workspace:*",
		"@testing-library/react": "^16.0.0",
		"@types/react": "^19.0.0",
		"jsdom": "^26.0.0",
		"react": "^19.0.0",
		"react-dom": "^19.0.0",
		"tsup": "^8.0.0",
		"typescript": "^5.7.0",
		"vitest": "^3.0.0",
		"zod": "^4.0.0"
	},
	"scripts": {
		"build": "tsup",
		"test": "vitest run",
		"test:watch": "vitest",
		"typecheck": "tsc --noEmit"
	},
	"engines": {
		"node": ">=18"
	}
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src",
		"jsx": "react-jsx",
		"lib": ["ES2022", "DOM"]
	},
	"include": ["src"],
	"exclude": ["node_modules", "dist", "__tests__"]
}
```

Note: `"DOM"` is needed because the `persist.storage` option uses the browser `Storage` interface type.

- [ ] **Step 3: Create `tsup.config.ts`**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
	},
});
```

- [ ] **Step 5: Create placeholder `src/index.ts`**

```typescript
// @rytejs/react — React bindings for workflow state management
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install` (from workspace root)
Expected: Dependencies resolved, `node_modules` populated for the react package

- [ ] **Step 7: Verify the package compiles**

Run: `pnpm --filter @rytejs/react tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/react/
git commit -m "chore(react): scaffold @rytejs/react package"
git push
```

---

## Chunk 2: Store

### Task 3: Define types

**Files:**
- Create: `packages/react/src/types.ts`

- [ ] **Step 1: Create `types.ts` with all interfaces**

```typescript
import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	MigrationPipeline,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowOf,
} from "@rytejs/core";

export interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
}

export interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig>;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	/**
	 * Replace the workflow directly. Used by sync adapters to apply
	 * server-pushed updates. Bypasses the router — caller is responsible
	 * for ensuring validity.
	 */
	setWorkflow(workflow: Workflow<TConfig>): void;
}

export interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
}

export interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly state: StateNames<TConfig>;
	readonly data: StateData<TConfig, StateNames<TConfig>>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	match<R>(
		matchers: {
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		},
	): R;
	match<R>(
		matchers: Partial<{
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		}>,
		fallback: (workflow: Workflow<TConfig>) => R,
	): R;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @rytejs/react tsc --noEmit`
Expected: No errors (types only, no runtime code yet)

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/types.ts
git commit -m "feat(react): add type definitions"
git push
```

---

### Task 4: Implement `createWorkflowStore` (core behavior, no persistence)

**Files:**
- Create: `packages/react/__tests__/helpers.ts`
- Create: `packages/react/__tests__/store.test.ts`
- Create: `packages/react/src/store.ts`

- [ ] **Step 1: Create shared test helpers**

Create `packages/react/__tests__/helpers.ts`:

```typescript
import { WorkflowRouter, defineWorkflow } from "@rytejs/core";
import { z } from "zod";

export const definition = defineWorkflow("todo", {
	states: {
		Pending: z.object({ title: z.string() }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
		Rename: z.object({ title: z.string() }),
	},
	events: {
		TodoStarted: z.object({ assignee: z.string() }),
		TodoCompleted: z.object({ todoId: z.string() }),
	},
	errors: {
		AlreadyAssigned: z.object({ current: z.string() }),
	},
});

export type TodoConfig = (typeof definition)["config"];

export function createTestRouter() {
	const router = new WorkflowRouter(definition);

	router.state("Pending", ({ on }) => {
		on("Start", ({ command, transition, emit }) => {
			transition("InProgress", {
				title: "My Todo",
				assignee: command.payload.assignee,
			});
			emit({ type: "TodoStarted", data: { assignee: command.payload.assignee } });
		});
		on("Rename", ({ command, update }) => {
			update({ title: command.payload.title });
		});
	});

	router.state("InProgress", ({ on }) => {
		on("Complete", ({ workflow, transition, emit }) => {
			transition("Done", {
				title: workflow.data.title,
				completedAt: new Date(),
			});
			emit({ type: "TodoCompleted", data: { todoId: workflow.id } });
		});
		on("Rename", ({ command, update }) => {
			update({ title: command.payload.title });
		});
	});

	return router;
}
```

- [ ] **Step 2: Write store tests**

Create `packages/react/__tests__/store.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter, definition } from "./helpers.js";

describe("createWorkflowStore", () => {
	test("creates store with initial workflow in specified state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snapshot = store.getSnapshot();
		expect(snapshot.workflow.state).toBe("Pending");
		expect(snapshot.workflow.data).toEqual({ title: "Test" });
		expect(snapshot.isDispatching).toBe(false);
		expect(snapshot.error).toBeNull();
	});

	test("creates workflow with custom id", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
			id: "custom-id",
		});

		expect(store.getWorkflow().id).toBe("custom-id");
	});

	test("creates workflow with generated id when not provided", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		expect(store.getWorkflow().id).toBeTruthy();
		expect(typeof store.getWorkflow().id).toBe("string");
	});

	test("dispatch updates workflow on success", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(true);
		expect(store.getSnapshot().workflow.state).toBe("InProgress");
		expect(store.getSnapshot().workflow.data).toMatchObject({ assignee: "Alice" });
	});

	test("dispatch returns DispatchResult on failure", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("router");
		}
	});

	test("dispatch sets error on failure", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		await store.dispatch("Start", { assignee: "Alice" });

		const snapshot = store.getSnapshot();
		expect(snapshot.error).not.toBeNull();
		expect(snapshot.error?.category).toBe("router");
	});

	test("error clears on next successful dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		// Dispatch a command with no handler in Pending → sets error
		await store.dispatch("Complete", {});
		expect(store.getSnapshot().error).not.toBeNull();

		// Dispatch a valid command → should clear error
		await store.dispatch("Rename", { title: "Renamed" });
		expect(store.getSnapshot().error).toBeNull();
		expect(store.getSnapshot().workflow.data).toMatchObject({ title: "Renamed" });
	});

	test("isDispatching is true during dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snapshots: Array<{ isDispatching: boolean }> = [];
		store.subscribe(() => {
			snapshots.push({ isDispatching: store.getSnapshot().isDispatching });
		});

		await store.dispatch("Start", { assignee: "Alice" });

		// First notification: isDispatching=true, second: isDispatching=false
		expect(snapshots).toEqual([
			{ isDispatching: true },
			{ isDispatching: false },
		]);
	});

	test("subscribe notifies on dispatch (twice: start + end)", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const listener = vi.fn();
		store.subscribe(listener);
		await store.dispatch("Start", { assignee: "Alice" });

		// Called twice: isDispatching=true, then completion
		expect(listener).toHaveBeenCalledTimes(2);
	});

	test("unsubscribe stops notifications", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const listener = vi.fn();
		const unsub = store.subscribe(listener);
		unsub();
		await store.dispatch("Start", { assignee: "Alice" });

		expect(listener).not.toHaveBeenCalled();
	});

	test("getSnapshot returns same reference when nothing changed", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snap1 = store.getSnapshot();
		const snap2 = store.getSnapshot();
		expect(snap1).toBe(snap2);
	});

	test("getSnapshot returns new reference after dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snap1 = store.getSnapshot();
		await store.dispatch("Start", { assignee: "Alice" });
		const snap2 = store.getSnapshot();
		expect(snap1).not.toBe(snap2);
	});

	test("setWorkflow replaces the workflow and notifies", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const listener = vi.fn();
		store.subscribe(listener);

		const newWorkflow = definition.createWorkflow("new-id", {
			initialState: "Done",
			data: { title: "Done", completedAt: new Date() },
		});
		store.setWorkflow(newWorkflow);

		expect(store.getSnapshot().workflow.state).toBe("Done");
		expect(store.getSnapshot().workflow.id).toBe("new-id");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	test("setWorkflow clears error", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		await store.dispatch("Start", { assignee: "Alice" });
		expect(store.getSnapshot().error).not.toBeNull();

		const newWorkflow = definition.createWorkflow("id", {
			initialState: "Pending",
			data: { title: "Fresh" },
		});
		store.setWorkflow(newWorkflow);
		expect(store.getSnapshot().error).toBeNull();
	});

	test("dispatch function is a stable reference", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const d1 = store.dispatch;
		const d2 = store.dispatch;
		expect(d1).toBe(d2);
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/react vitest run __tests__/store.test.ts`
Expected: FAIL — `createWorkflowStore` is not exported

- [ ] **Step 4: Implement `createWorkflowStore`**

Create `packages/react/src/store.ts`:

```typescript
import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
} from "@rytejs/core";
import { WorkflowRouter, migrate } from "@rytejs/core";
import type { WorkflowStore, WorkflowStoreOptions, WorkflowStoreSnapshot } from "./types.js";

export function createWorkflowStore<
	TConfig extends WorkflowConfig,
	TDeps,
	S extends StateNames<TConfig>,
>(
	router: WorkflowRouter<TConfig, TDeps>,
	initialConfig: {
		state: S;
		data: StateData<TConfig, S>;
		id?: string;
	},
	options?: WorkflowStoreOptions<TConfig>,
): WorkflowStore<TConfig> {
	const definition = router.definition;

	let workflow: Workflow<TConfig> = loadOrCreate(definition, initialConfig, options);
	let isDispatching = false;
	let error: PipelineError<TConfig> | null = null;
	let snapshot: WorkflowStoreSnapshot<TConfig> = { workflow, isDispatching, error };

	const listeners = new Set<() => void>();

	function notify() {
		snapshot = { workflow, isDispatching, error };
		for (const listener of listeners) {
			listener();
		}
	}

	const dispatch = async <C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>> => {
		isDispatching = true;
		notify();

		const result = await router.dispatch(workflow, { type: command, payload });

		if (result.ok) {
			workflow = result.workflow;
			error = null;
		} else {
			error = result.error;
		}
		isDispatching = false;
		notify();

		if (result.ok && options?.persist) {
			const { key, storage } = options.persist;
			const snap = definition.snapshot(workflow);
			storage.setItem(key, JSON.stringify(snap));
		}

		return result;
	};

	return {
		getWorkflow: () => workflow,
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispatch,
		setWorkflow: (newWorkflow) => {
			workflow = newWorkflow;
			error = null;
			notify();
		},
	};
}

function loadOrCreate<TConfig extends WorkflowConfig, S extends StateNames<TConfig>>(
	definition: WorkflowDefinition<TConfig>,
	initialConfig: { state: S; data: StateData<TConfig, S>; id?: string },
	options?: WorkflowStoreOptions<TConfig>,
): Workflow<TConfig> {
	if (options?.persist) {
		const { key, storage, migrations } = options.persist;
		try {
			const stored = storage.getItem(key);
			if (stored) {
				let parsed = JSON.parse(stored);
				if (migrations) {
					const migrated = migrate(migrations, parsed);
					if (migrated.ok) {
						parsed = migrated.snapshot;
					} else {
						return createFresh(definition, initialConfig);
					}
				}
				const restored = definition.restore(parsed);
				if (restored.ok) {
					return restored.workflow;
				}
			}
		} catch {
			// Invalid JSON or restore failed — fall through to create fresh
		}
	}

	return createFresh(definition, initialConfig);
}

function createFresh<TConfig extends WorkflowConfig, S extends StateNames<TConfig>>(
	definition: WorkflowDefinition<TConfig>,
	initialConfig: { state: S; data: StateData<TConfig, S>; id?: string },
): Workflow<TConfig> {
	return definition.createWorkflow(initialConfig.id ?? crypto.randomUUID(), {
		initialState: initialConfig.state,
		data: initialConfig.data,
	});
}
```

- [ ] **Step 5: Export from `index.ts` temporarily for testing**

Update `packages/react/src/index.ts`:

```typescript
export { createWorkflowStore } from "./store.js";
export type {
	UseWorkflowReturn,
	WorkflowStore,
	WorkflowStoreOptions,
	WorkflowStoreSnapshot,
} from "./types.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/react vitest run __tests__/store.test.ts`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/store.ts packages/react/src/index.ts packages/react/src/types.ts packages/react/__tests__/helpers.ts packages/react/__tests__/store.test.ts
git commit -m "feat(react): implement createWorkflowStore"
git push
```

---

### Task 5: Persistence adapter

**Files:**
- Create: `packages/react/__tests__/persistence.test.ts`
- Modify: `packages/react/src/store.ts` (already has persistence code from Task 4)

- [ ] **Step 1: Write persistence tests**

Create `packages/react/__tests__/persistence.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter, definition } from "./helpers.js";

function createMockStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
		clear: () => data.clear(),
		get length() {
			return data.size;
		},
		key: (index) => [...data.keys()][index] ?? null,
	};
}

describe("persistence", () => {
	test("saves snapshot to storage after successful dispatch", async () => {
		const storage = createMockStorage();
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" } },
			{ persist: { key: "test-workflow", storage } },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		const stored = storage.getItem("test-workflow");
		expect(stored).not.toBeNull();
		const parsed = JSON.parse(stored!);
		expect(parsed.state).toBe("InProgress");
	});

	test("does not save to storage on failed dispatch", async () => {
		const storage = createMockStorage();
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Done", data: { title: "Test", completedAt: new Date() } },
			{ persist: { key: "test-workflow", storage } },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		expect(storage.getItem("test-workflow")).toBeNull();
	});

	test("restores workflow from storage on creation", async () => {
		const storage = createMockStorage();
		const router = createTestRouter();

		// First store: dispatch to change state, which persists
		const store1 = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ persist: { key: "test-workflow", storage } },
		);
		await store1.dispatch("Start", { assignee: "Alice" });

		// Second store: should restore from storage
		const store2 = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "test-workflow", storage } },
		);

		expect(store2.getSnapshot().workflow.state).toBe("InProgress");
		expect(store2.getSnapshot().workflow.id).toBe("wf-1");
	});

	test("falls back to initial config when storage is empty", () => {
		const storage = createMockStorage();
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "nonexistent", storage } },
		);

		expect(store.getSnapshot().workflow.state).toBe("Pending");
		expect(store.getSnapshot().workflow.data).toEqual({ title: "Fallback" });
	});

	test("falls back to initial config when stored data is corrupt", () => {
		const storage = createMockStorage();
		storage.setItem("test-workflow", "not-json");
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "test-workflow", storage } },
		);

		expect(store.getSnapshot().workflow.state).toBe("Pending");
	});

	test("falls back when stored snapshot fails validation", () => {
		const storage = createMockStorage();
		// Store a snapshot with invalid data for the state
		storage.setItem(
			"test-workflow",
			JSON.stringify({
				id: "old",
				definitionName: "todo",
				state: "Pending",
				data: { invalidField: true },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
			}),
		);
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "test-workflow", storage } },
		);

		expect(store.getSnapshot().workflow.state).toBe("Pending");
		expect(store.getSnapshot().workflow.data).toEqual({ title: "Fallback" });
	});
});
```

- [ ] **Step 2: Run tests to verify they pass**

The persistence logic is already implemented in Task 4's `store.ts`. Run:

Run: `pnpm --filter @rytejs/react vitest run __tests__/persistence.test.ts`
Expected: All tests pass. If any fail, fix the `loadOrCreate` function.

- [ ] **Step 3: Commit**

```bash
git add packages/react/__tests__/persistence.test.ts
git commit -m "test(react): add persistence adapter tests"
git push
```

---

## Chunk 3: React Hooks

### Task 6: Implement `useWorkflow` (full + selector modes)

**Files:**
- Create: `packages/react/__tests__/use-workflow.test.ts`
- Create: `packages/react/src/use-workflow.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write hook tests**

Create `packages/react/__tests__/use-workflow.test.ts`:

```typescript
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { useWorkflow } from "../src/use-workflow.js";
import { createTestRouter, definition } from "./helpers.js";

describe("useWorkflow — full mode", () => {
	test("returns workflow state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		expect(result.current.workflow.state).toBe("Pending");
		expect(result.current.state).toBe("Pending");
		expect(result.current.data).toEqual({ title: "Test" });
		expect(result.current.isDispatching).toBe(false);
		expect(result.current.error).toBeNull();
	});

	test("updates after dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		await act(async () => {
			await store.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current.workflow.state).toBe("InProgress");
		expect(result.current.state).toBe("InProgress");
	});

	test("dispatch function works from the hook return", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		await act(async () => {
			const dispatchResult = await result.current.dispatch("Start", {
				assignee: "Alice",
			});
			expect(dispatchResult.ok).toBe(true);
		});

		expect(result.current.state).toBe("InProgress");
	});

	test("dispatch reference is stable across renders", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result, rerender } = renderHook(() => useWorkflow(store));
		const dispatch1 = result.current.dispatch;
		rerender();
		const dispatch2 = result.current.dispatch;

		expect(dispatch1).toBe(dispatch2);
	});

	test("error is set on failed dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		const { result } = renderHook(() => useWorkflow(store));

		await act(async () => {
			await result.current.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current.error).not.toBeNull();
		expect(result.current.error?.category).toBe("router");
	});
});

describe("useWorkflow — match", () => {
	test("exhaustive match returns correct value", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		const label = result.current.match({
			Pending: (data) => `pending: ${data.title}`,
			InProgress: (data) => `in-progress: ${data.assignee}`,
			Done: (data) => `done: ${data.title}`,
		});

		expect(label).toBe("pending: Test");
	});

	test("partial match with fallback uses fallback for unmatched state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "InProgress",
			data: { title: "Test", assignee: "Alice" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		const label = result.current.match(
			{ Pending: () => "pending" },
			(wf) => `other: ${wf.state}`,
		);

		expect(label).toBe("other: InProgress");
	});

	test("partial match calls matcher when state matches", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		const label = result.current.match(
			{ Pending: (data) => `found: ${data.title}` },
			() => "fallback",
		);

		expect(label).toBe("found: Test");
	});
});

describe("useWorkflow — selector mode", () => {
	test("returns selected value", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() =>
			useWorkflow(store, (w) => w.data.title),
		);

		expect(result.current).toBe("Test");
	});

	test("updates when selected value changes", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() =>
			useWorkflow(store, (w) => w.state),
		);

		expect(result.current).toBe("Pending");

		await act(async () => {
			await store.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current).toBe("InProgress");
	});

	test("selector with state narrowing", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "InProgress",
			data: { title: "Test", assignee: "Alice" },
		});

		const { result } = renderHook(() =>
			useWorkflow(
				store,
				(w) => (w.state === "InProgress" ? w.data.assignee : null),
			),
		);

		expect(result.current).toBe("Alice");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/react vitest run __tests__/use-workflow.test.ts`
Expected: FAIL — `useWorkflow` is not exported

- [ ] **Step 3: Implement `useWorkflow`**

Create `packages/react/src/use-workflow.ts`:

```typescript
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Workflow, WorkflowConfig } from "@rytejs/core";
import type { UseWorkflowReturn, WorkflowStore, WorkflowStoreSnapshot } from "./types.js";

function createReturn<TConfig extends WorkflowConfig>(
	snapshot: WorkflowStoreSnapshot<TConfig>,
	dispatch: WorkflowStore<TConfig>["dispatch"],
): UseWorkflowReturn<TConfig> {
	return {
		workflow: snapshot.workflow,
		state: snapshot.workflow.state,
		data: snapshot.workflow.data,
		isDispatching: snapshot.isDispatching,
		error: snapshot.error,
		dispatch,
		// biome-ignore lint/suspicious/noExplicitAny: match overloads handled by UseWorkflowReturn type
		match(matchers: Record<string, any>, fallback?: (workflow: Workflow<TConfig>) => any): any {
			const state = snapshot.workflow.state as string;
			const matcher = matchers[state];
			if (matcher) {
				return matcher(snapshot.workflow.data, snapshot.workflow);
			}
			if (fallback) {
				return fallback(snapshot.workflow);
			}
			throw new Error(`No match for state "${state}" and no fallback provided`);
		},
	} as UseWorkflowReturn<TConfig>;
}

export function useWorkflow<TConfig extends WorkflowConfig>(
	store: WorkflowStore<TConfig>,
): UseWorkflowReturn<TConfig>;
export function useWorkflow<TConfig extends WorkflowConfig, R>(
	store: WorkflowStore<TConfig>,
	selector: (workflow: Workflow<TConfig>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): R;
export function useWorkflow<TConfig extends WorkflowConfig, R>(
	store: WorkflowStore<TConfig>,
	selector?: (workflow: Workflow<TConfig>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): UseWorkflowReturn<TConfig> | R {
	// Refs for selector caching — always allocated to maintain hook call order
	const selectorRef = useRef(selector);
	const equalityFnRef = useRef(equalityFn);
	const cachedRef = useRef<R | undefined>(undefined);
	const hasCachedRef = useRef(false);
	selectorRef.current = selector;
	equalityFnRef.current = equalityFn;

	const selectorSnapshot = useCallback(() => {
		const next = selectorRef.current!(store.getWorkflow());
		const eq = equalityFnRef.current ?? Object.is;
		if (hasCachedRef.current && eq(cachedRef.current as R, next)) {
			return cachedRef.current;
		}
		cachedRef.current = next;
		hasCachedRef.current = true;
		return next;
	}, [store]);

	const getSnapshot = selector ? selectorSnapshot : store.getSnapshot;

	// biome-ignore lint/suspicious/noExplicitAny: return type varies by overload (snapshot vs selected value)
	const result: any = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);

	if (!selector) {
		return createReturn(result as WorkflowStoreSnapshot<TConfig>, store.dispatch);
	}
	return result as R;
}
```

- [ ] **Step 4: Add `useWorkflow` to exports**

Update `packages/react/src/index.ts`:

```typescript
export { createWorkflowStore } from "./store.js";
export { useWorkflow } from "./use-workflow.js";
export type {
	UseWorkflowReturn,
	WorkflowStore,
	WorkflowStoreOptions,
	WorkflowStoreSnapshot,
} from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/react vitest run __tests__/use-workflow.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/use-workflow.ts packages/react/src/index.ts packages/react/__tests__/use-workflow.test.ts
git commit -m "feat(react): implement useWorkflow hook with selector support"
git push
```

---

### Task 7: Implement `createWorkflowContext`

**Files:**
- Create: `packages/react/__tests__/context.test.ts`
- Create: `packages/react/src/context.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write context tests**

Create `packages/react/__tests__/context.test.ts`:

```typescript
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { createWorkflowContext } from "../src/context.js";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter, definition } from "./helpers.js";

const TodoWorkflow = createWorkflowContext(definition);

function createWrapper(store: ReturnType<typeof createWorkflowStore>) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(TodoWorkflow.Provider, { store }, children);
	};
}

describe("createWorkflowContext", () => {
	test("useWorkflow returns workflow state from context", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow(), {
			wrapper: createWrapper(store),
		});

		expect(result.current.state).toBe("Pending");
		expect(result.current.data).toEqual({ title: "Test" });
	});

	test("useWorkflow with selector from context", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(
			() => TodoWorkflow.useWorkflow((w) => w.data.title),
			{ wrapper: createWrapper(store) },
		);

		expect(result.current).toBe("Test");
	});

	test("dispatch through context updates state", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow(), {
			wrapper: createWrapper(store),
		});

		await act(async () => {
			await result.current.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current.state).toBe("InProgress");
	});

	test("throws when used outside Provider", () => {
		expect(() => {
			renderHook(() => TodoWorkflow.useWorkflow());
		}).toThrow(/must be used within/i);
	});

	test("match works through context", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow(), {
			wrapper: createWrapper(store),
		});

		const label = result.current.match({
			Pending: (data) => `pending: ${data.title}`,
			InProgress: (data) => `wip: ${data.assignee}`,
			Done: () => "done",
		});

		expect(label).toBe("pending: Test");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/react vitest run __tests__/context.test.ts`
Expected: FAIL — `createWorkflowContext` is not exported

- [ ] **Step 3: Implement `createWorkflowContext`**

Create `packages/react/src/context.ts`:

```typescript
import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { Workflow, WorkflowConfig, WorkflowDefinition } from "@rytejs/core";
import type { UseWorkflowReturn, WorkflowStore } from "./types.js";
import { useWorkflow } from "./use-workflow.js";

export function createWorkflowContext<TConfig extends WorkflowConfig>(
	_definition: WorkflowDefinition<TConfig>,
): {
	Provider: (props: { store: WorkflowStore<TConfig>; children: ReactNode }) => ReactNode;
	useWorkflow: {
		(): UseWorkflowReturn<TConfig>;
		<R>(selector: (workflow: Workflow<TConfig>) => R, equalityFn?: (a: R, b: R) => boolean): R;
	};
} {
	const StoreContext = createContext<WorkflowStore<TConfig> | null>(null);

	function Provider({
		store,
		children,
	}: { store: WorkflowStore<TConfig>; children: ReactNode }): ReactNode {
		return createElement(StoreContext.Provider, { value: store }, children);
	}

	function useWorkflowFromContext(): UseWorkflowReturn<TConfig>;
	function useWorkflowFromContext<R>(
		selector: (workflow: Workflow<TConfig>) => R,
		equalityFn?: (a: R, b: R) => boolean,
	): R;
	function useWorkflowFromContext<R>(
		selector?: (workflow: Workflow<TConfig>) => R,
		equalityFn?: (a: R, b: R) => boolean,
	): UseWorkflowReturn<TConfig> | R {
		const store = useContext(StoreContext);
		if (!store) {
			throw new Error(
				"useWorkflow must be used within a WorkflowProvider. " +
					"Wrap your component tree with <Provider store={...}>.",
			);
		}
		if (selector) {
			return useWorkflow(store, selector, equalityFn);
		}
		return useWorkflow(store);
	}

	return { Provider, useWorkflow: useWorkflowFromContext };
}
```

- [ ] **Step 4: Add `createWorkflowContext` to exports**

Update `packages/react/src/index.ts`:

```typescript
export { createWorkflowContext } from "./context.js";
export { createWorkflowStore } from "./store.js";
export { useWorkflow } from "./use-workflow.js";
export type {
	UseWorkflowReturn,
	WorkflowStore,
	WorkflowStoreOptions,
	WorkflowStoreSnapshot,
} from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/react vitest run __tests__/context.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/context.ts packages/react/src/index.ts packages/react/__tests__/context.test.ts
git commit -m "feat(react): implement createWorkflowContext"
git push
```

---

## Chunk 4: Finalization

### Task 8: Type-level tests

**Files:**
- Create: `packages/react/__tests__/types.test.ts`

- [ ] **Step 1: Write type-level tests**

Create `packages/react/__tests__/types.test.ts`:

```typescript
import { describe, expectTypeOf, test } from "vitest";
import type { DispatchResult, PipelineError, Workflow, WorkflowOf } from "@rytejs/core";
import { createWorkflowStore } from "../src/store.js";
import { useWorkflow } from "../src/use-workflow.js";
import { createWorkflowContext } from "../src/context.js";
import type { UseWorkflowReturn, WorkflowStore } from "../src/types.js";
import { createTestRouter, definition, type TodoConfig } from "./helpers.js";

describe("type inference", () => {
	test("createWorkflowStore infers TConfig from router", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		expectTypeOf(store).toMatchTypeOf<WorkflowStore<TodoConfig>>();
	});

	test("useWorkflow full mode returns UseWorkflowReturn", () => {
		// Type-only test: verify the overload signature resolves
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		// In a real hook context this would be called inside a component.
		// Here we just verify the type signature exists.
		expectTypeOf(useWorkflow<TodoConfig>).parameter(0).toMatchTypeOf<WorkflowStore<TodoConfig>>();
	});

	test("dispatch is typed with command names and payloads", () => {
		type Dispatch = UseWorkflowReturn<TodoConfig>["dispatch"];

		// Should accept valid command + payload
		expectTypeOf<Dispatch>().toBeCallableWith("Start", { assignee: "Alice" });
		expectTypeOf<Dispatch>().toBeCallableWith("Complete", {});
		expectTypeOf<Dispatch>().toBeCallableWith("Rename", { title: "New" });
	});

	test("dispatch returns Promise<DispatchResult>", () => {
		type Dispatch = UseWorkflowReturn<TodoConfig>["dispatch"];
		type Return = ReturnType<Dispatch>;

		expectTypeOf<Return>().toMatchTypeOf<Promise<DispatchResult<TodoConfig>>>();
	});

	test("workflow is a discriminated union", () => {
		type W = UseWorkflowReturn<TodoConfig>["workflow"];

		expectTypeOf<W>().toMatchTypeOf<Workflow<TodoConfig>>();
	});

	test("error is PipelineError or null", () => {
		type E = UseWorkflowReturn<TodoConfig>["error"];

		expectTypeOf<E>().toMatchTypeOf<PipelineError<TodoConfig> | null>();
	});

	test("createWorkflowContext infers from definition", () => {
		const ctx = createWorkflowContext(definition);

		expectTypeOf(ctx.Provider).toBeFunction();
		expectTypeOf(ctx.useWorkflow).toBeFunction();
	});
});
```

- [ ] **Step 2: Run type tests**

Run: `pnpm --filter @rytejs/react vitest run __tests__/types.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/react/__tests__/types.test.ts
git commit -m "test(react): add type-level inference tests"
git push
```

---

### Task 9: Build, lint, and full verification

**Files:**
- Modify: `packages/react/src/index.ts` (verify final exports)

- [ ] **Step 1: Run all react package tests**

Run: `pnpm --filter @rytejs/react vitest run`
Expected: All tests pass (store, persistence, use-workflow, context, types)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rytejs/react tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Lint**

Run: `pnpm biome check packages/react/`
Expected: No lint errors. If there are auto-fixable issues, run `pnpm biome check --fix packages/react/`

- [ ] **Step 4: Build the package**

Run: `cd packages/react && pnpm tsup`
Expected: Build succeeds with ESM, CJS, and DTS outputs

- [ ] **Step 5: Verify build output**

Run: `ls -la packages/react/dist/`
Expected: `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts`, plus sourcemaps

- [ ] **Step 6: Run workspace-level check**

Run: `pnpm run check`
Expected: All packages pass typecheck + test + lint (core: 175 tests, testing: 31 tests, otel: 18 tests, react: all new tests)

- [ ] **Step 7: Commit and push**

```bash
git add -A packages/react/
git commit -m "feat(react): finalize @rytejs/react v0.6.0"
git push
```
