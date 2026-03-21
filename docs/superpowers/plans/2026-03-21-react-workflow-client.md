# React `createWorkflowClient` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate local and remote workflow stores in `@rytejs/react` — add `createWorkflowClient(transport)` for server-backed workflows, remove transport support from `createWorkflowStore`.

**Architecture:** `createWorkflowStore` becomes local-only (router + optional persistence). `createWorkflowClient` is a new function that returns a client with `.connect(definition, id)` for remote workflows. Both produce a `WorkflowStore<TConfig>` consumable by `useWorkflow()`. The `Transport` interface gains a `load()` method for initial state bootstrapping. Remote stores start in a loading state (`workflow: null, isLoading: true`) and transition once the initial load completes.

**Tech Stack:** TypeScript, React 18+, Vitest, pnpm, tsup

**Spec:** `docs/superpowers/specs/2026-03-21-mission-control-example-design.md` (Library Change section)

**Key design decision — nullable workflow:** Remote stores start with `workflow: null` during loading. This requires `WorkflowStoreSnapshot.workflow` to be `Workflow<TConfig> | null`, and all consumers to handle the null case. `createWorkflowStore` (local) always has a workflow — its snapshot is never null. The nullability only applies to remote stores via `createWorkflowClient`.

---

### Task 1: Add `load()` to Transport interface and make snapshot workflow nullable

Extend the `Transport` interface with a `load` method. Update types for nullable workflow support.

**Files:**
- Modify: `packages/react/src/transport.ts:9-17`
- Modify: `packages/react/src/types.ts:14-18,20-30,32-39`

- [ ] **Step 1: Add `load` to Transport interface**

In `packages/react/src/transport.ts`, add `load` as the first method of the `Transport` interface. Use `StoredWorkflow` from core:

```ts
import type { WorkflowSnapshot } from "@rytejs/core";
import type { StoredWorkflow } from "@rytejs/core/store";

// ... BroadcastMessage unchanged ...

export interface Transport {
	load(id: string): Promise<StoredWorkflow | null>;

	dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult>;

	subscribe(id: string, callback: (message: BroadcastMessage) => void): TransportSubscription;
}
```

- [ ] **Step 2: Make `WorkflowStoreSnapshot.workflow` nullable and add `isLoading`**

In `packages/react/src/types.ts`, update `WorkflowStoreSnapshot`:

```ts
export interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig> | null;
	readonly isLoading: boolean;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
}
```

- [ ] **Step 3: Update `WorkflowStore` interface for nullable workflow**

In `packages/react/src/types.ts`, update `getWorkflow()`:

```ts
export interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig> | null;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	setWorkflow(workflow: Workflow<TConfig>): void;
	cleanup(): void;
}
```

- [ ] **Step 4: Remove `transport` from `WorkflowStoreOptions`**

In `packages/react/src/types.ts`, remove the `transport` field and the `Transport` import:

```ts
export interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
}
```

Remove the import line: `import type { Transport } from "./transport.js";`

- [ ] **Step 5: Add `isLoading` to `UseWorkflowReturn`**

In `packages/react/src/types.ts`, add `isLoading` to `UseWorkflowReturn`:

```ts
export interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig> | null;
	readonly state: StateNames<TConfig>;
	readonly data: StateData<TConfig, StateNames<TConfig>>;
	readonly isLoading: boolean;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
	// ... dispatch and match overloads unchanged
```

- [ ] **Step 6: Typecheck (expect some failures from store.ts and use-workflow.ts)**

```bash
cd packages/react && npx tsc --noEmit 2>&1 | head -30
```

Expected: Type errors in `store.ts` (transport code) and `use-workflow.ts` (null handling). These are fixed in Tasks 2-3.

- [ ] **Step 7: Commit type changes**

```bash
git add packages/react/src/transport.ts packages/react/src/types.ts && git commit -m "feat(react): add Transport.load(), make workflow nullable, add isLoading"
```

---

### Task 2: Update `useWorkflow` for nullable workflow

The hook needs to handle `workflow: null` in both full mode and selector mode.

**Files:**
- Modify: `packages/react/src/use-workflow.ts:5-29` (createReturn function)
- Modify: `packages/react/src/use-workflow.ts:44-62` (selector path)

- [ ] **Step 1: Update `createReturn` for nullable workflow**

In `packages/react/src/use-workflow.ts`, update the `createReturn` function to handle null workflow:

```ts
function createReturn<TConfig extends WorkflowConfig>(
	snapshot: WorkflowStoreSnapshot<TConfig>,
	dispatch: WorkflowStore<TConfig>["dispatch"],
): UseWorkflowReturn<TConfig> {
	const wf = snapshot.workflow;
	return {
		workflow: wf,
		// biome-ignore lint/suspicious/noExplicitAny: state/data are undefined when workflow is null (loading) — consumers check isLoading first
		state: wf?.state as any,
		// biome-ignore lint/suspicious/noExplicitAny: see above
		data: wf?.data as any,
		isLoading: snapshot.isLoading,
		isDispatching: snapshot.isDispatching,
		error: snapshot.error,
		dispatch,
		match(matchers: Record<string, (data: unknown, workflow: unknown) => unknown>, fallback?: (workflow: unknown) => unknown) {
			if (!wf) {
				if (fallback) return fallback(wf);
				throw new Error("Cannot match on a loading workflow — check isLoading first");
			}
			const state = wf.state as string;
			const matcher = matchers[state];
			if (matcher) {
				return matcher(wf.data, wf);
			}
			if (fallback) {
				return fallback(wf);
			}
			throw new Error(`No match for state "${state}" and no fallback provided`);
		},
	};
}
```

- [ ] **Step 2: Guard selector path against null workflow**

In `packages/react/src/use-workflow.ts`, in the selector snapshot path (around line 54), guard against null workflow:

```ts
const next = store.getWorkflow() !== null
	? selectorRef.current!(store.getWorkflow()!)
	: undefined;
```

And update the equality check to handle undefined:

```ts
if (hasCachedRef.current && next !== undefined) {
	const eq = equalityFnRef.current ?? Object.is;
	if (eq(cachedRef.current as R, next as R)) {
		return cachedRef.current as R;
	}
}
if (next !== undefined) {
	cachedRef.current = next;
	hasCachedRef.current = true;
}
return cachedRef.current as R;
```

- [ ] **Step 3: Run existing tests**

```bash
pnpm --filter @rytejs/react run test -- __tests__/use-workflow.test.ts __tests__/store.test.ts
```

Expected: Some failures due to `isLoading` not being set in store. Fix in Task 3.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/use-workflow.ts && git commit -m "feat(react): handle nullable workflow in useWorkflow hook"
```

---

### Task 3: Remove transport from `createWorkflowStore` and fix tests

Strip transport code from the local store. Add `isLoading: false` to local store snapshots.

**Files:**
- Modify: `packages/react/src/store.ts`
- Modify: `packages/react/__tests__/store.test.ts`
- Delete: `packages/react/__tests__/transport-store.test.ts`

- [ ] **Step 1: Remove transport code from `createWorkflowStore`**

In `packages/react/src/store.ts`:

1. Remove the `BroadcastMessage` import (line 13)
2. Remove the transport guard (lines 31-33: `if (options?.transport && !initialConfig.id)`)
3. Remove the `version` variable (line 40: `let version = 0;`)
4. Remove the entire transport dispatch path in the `dispatch` function (lines 57-90 — the `if (options?.transport)` block)
5. Remove the transport subscription setup (lines 112-126)
6. Remove `transportSubscription?.unsubscribe()` from `cleanup()` (line 144)
7. Make `cleanup()` a no-op: `cleanup() {},`
8. Add `isLoading: false` to the initial snapshot and `notify()`:

```ts
let snapshot: WorkflowStoreSnapshot<TConfig> = { workflow, isLoading: false, isDispatching, error };

function notify() {
	snapshot = { workflow, isLoading: false, isDispatching, error };
	for (const listener of listeners) {
		listener();
	}
}
```

- [ ] **Step 2: Fix store tests for new snapshot shape**

In `packages/react/__tests__/store.test.ts`, update any assertions that check `getSnapshot()` to expect `isLoading: false`. Search for `getSnapshot()` assertions and add `isLoading: false` where needed. Also update assertions that check snapshot properties to account for the `workflow | null` type (local store always has a non-null workflow, so just add `!` where needed for type narrowing, or use `expect(snapshot.workflow).not.toBeNull()`).

- [ ] **Step 3: Delete `transport-store.test.ts`**

```bash
rm packages/react/__tests__/transport-store.test.ts
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @rytejs/react run test
```

Expected: All remaining tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/react && npx tsc --noEmit
```

Expected: Clean (transport code removed, types consistent).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(react): remove transport from createWorkflowStore"
```

---

### Task 4: Implement `createWorkflowClient`

The new API for remote workflow stores.

**Files:**
- Create: `packages/react/src/client.ts`
- Create: `packages/react/__tests__/client.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/react/__tests__/client.test.ts`:

```ts
import type { WorkflowSnapshot } from "@rytejs/core";
import { describe, expect, test, vi } from "vitest";
import { createWorkflowClient } from "../src/client.js";
import type { BroadcastMessage, Transport } from "../src/transport.js";
import { definition } from "./helpers.js";

function seedSnapshot(state: string, data: Record<string, unknown>): WorkflowSnapshot {
	const workflow = definition.createWorkflow("test-1", {
		initialState: state,
		data,
	});
	return definition.snapshot(workflow);
}

function createMockTransport(overrides?: Partial<Transport>): Transport {
	return {
		load: vi.fn(async () => ({
			snapshot: seedSnapshot("Pending", { title: "Test" }),
			version: 1,
		})),
		dispatch: vi.fn(async () => ({
			ok: true as const,
			snapshot: seedSnapshot("InProgress", { title: "Test", assignee: "Alice" }),
			version: 2,
			events: [{ type: "TodoStarted", data: { taskId: "test-1", assignee: "Alice" } }],
		})),
		subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
		...overrides,
	};
}

describe("createWorkflowClient", () => {
	test("connect returns a WorkflowStore", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		expect(store).toBeDefined();
		expect(typeof store.getSnapshot).toBe("function");
		expect(typeof store.subscribe).toBe("function");
		expect(typeof store.dispatch).toBe("function");
		expect(typeof store.cleanup).toBe("function");
	});

	test("store starts in loading state", () => {
		const transport = createMockTransport({
			load: vi.fn(() => new Promise(() => {})), // never resolves
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		const snapshot = store.getSnapshot();
		expect(snapshot.isLoading).toBe(true);
		expect(snapshot.workflow).toBeNull();
		expect(snapshot.isDispatching).toBe(false);
		expect(snapshot.error).toBeNull();
	});

	test("loads initial state via transport.load()", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		expect(transport.load).toHaveBeenCalledWith("test-1");
		expect(store.getSnapshot().workflow).not.toBeNull();
		expect(store.getSnapshot().workflow!.state).toBe("Pending");
	});

	test("load failure sets error", async () => {
		const transport = createMockTransport({
			load: vi.fn(async () => { throw new Error("network down"); }),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		expect(store.getSnapshot().workflow).toBeNull();
		expect(store.getSnapshot().error).not.toBeNull();
	});

	test("load returns null (workflow not found)", async () => {
		const transport = createMockTransport({
			load: vi.fn(async () => null),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		expect(store.getSnapshot().workflow).toBeNull();
	});

	test("dispatch calls transport.dispatch with version", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		await store.dispatch("Start", { assignee: "Alice" });

		expect(transport.dispatch).toHaveBeenCalledWith(
			"test-1",
			{ type: "Start", payload: { assignee: "Alice" } },
			1,
		);
	});

	test("dispatch updates workflow from server response", async () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		await store.dispatch("Start", { assignee: "Alice" });

		expect(store.getSnapshot().workflow!.state).toBe("InProgress");
	});

	test("dispatch during loading rejects", async () => {
		const transport = createMockTransport({
			load: vi.fn(() => new Promise(() => {})), // never resolves
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(false);
	});

	test("subscribes to transport for live updates", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);
		client.connect(definition, "test-1");

		expect(transport.subscribe).toHaveBeenCalledWith("test-1", expect.any(Function));
	});

	test("broadcast updates workflow state", async () => {
		let broadcastCallback: ((msg: BroadcastMessage) => void) | null = null;
		const transport = createMockTransport({
			subscribe: vi.fn((_, cb) => {
				broadcastCallback = cb;
				return { unsubscribe: vi.fn() };
			}),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		await vi.waitFor(() => {
			expect(store.getSnapshot().isLoading).toBe(false);
		});

		broadcastCallback!({
			snapshot: seedSnapshot("Done", { title: "Test", completedAt: new Date().toISOString() }),
			version: 3,
			events: [],
		});

		expect(store.getSnapshot().workflow!.state).toBe("Done");
	});

	test("connect caches stores by definition + id", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);

		const store1 = client.connect(definition, "test-1");
		const store2 = client.connect(definition, "test-1");

		expect(store1).toBe(store2);
	});

	test("different ids return different stores", () => {
		const transport = createMockTransport();
		const client = createWorkflowClient(transport);

		const store1 = client.connect(definition, "test-1");
		const store2 = client.connect(definition, "test-2");

		expect(store1).not.toBe(store2);
	});

	test("cleanup unsubscribes from transport", () => {
		const unsubscribeFn = vi.fn();
		const transport = createMockTransport({
			subscribe: vi.fn(() => ({ unsubscribe: unsubscribeFn })),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");

		store.cleanup();

		expect(unsubscribeFn).toHaveBeenCalled();
	});

	test("cleanup prevents load callback from updating state", async () => {
		let resolveLoad: ((val: unknown) => void) | null = null;
		const transport = createMockTransport({
			load: vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; })),
		});
		const client = createWorkflowClient(transport);
		const store = client.connect(definition, "test-1");
		const listener = vi.fn();
		store.subscribe(listener);

		// Cleanup before load resolves
		store.cleanup();
		listener.mockClear();

		// Now resolve the load — should NOT notify
		resolveLoad!({
			snapshot: seedSnapshot("Pending", { title: "Test" }),
			version: 1,
		});

		// Give microtask a chance to fire
		await new Promise((r) => setTimeout(r, 10));
		expect(listener).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @rytejs/react run test -- __tests__/client.test.ts
```

Expected: FAIL — `../src/client.js` does not exist.

- [ ] **Step 3: Implement `createWorkflowClient`**

Create `packages/react/src/client.ts`:

```ts
import type {
	CommandNames,
	CommandPayload,
	DispatchResult,
	PipelineError,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
} from "@rytejs/core";
import type { BroadcastMessage, Transport, TransportSubscription } from "./transport.js";
import type { WorkflowStore, WorkflowStoreSnapshot } from "./types.js";

export function createWorkflowClient(transport: Transport) {
	const cache = new Map<string, WorkflowStore<WorkflowConfig>>();

	return {
		connect<TConfig extends WorkflowConfig>(
			definition: WorkflowDefinition<TConfig>,
			id: string,
		): WorkflowStore<TConfig> {
			const key = `${definition.name}:${id}`;
			const cached = cache.get(key);
			if (cached) return cached as WorkflowStore<TConfig>;

			const store = createRemoteStore<TConfig>(transport, definition, id);
			// biome-ignore lint/suspicious/noExplicitAny: type erasure — WorkflowStore<TConfig> stored as WorkflowStore<WorkflowConfig>
			cache.set(key, store as any);
			return store;
		},
	};
}

function createRemoteStore<TConfig extends WorkflowConfig>(
	transport: Transport,
	definition: WorkflowDefinition<TConfig>,
	id: string,
): WorkflowStore<TConfig> {
	let workflow: Workflow<TConfig> | null = null;
	let version = 0;
	let isLoading = true;
	let isDispatching = false;
	let error: PipelineError<TConfig> | null = null;
	let disposed = false;
	let snapshot: WorkflowStoreSnapshot<TConfig> = { workflow, isLoading, isDispatching, error };
	const listeners = new Set<() => void>();

	function notify() {
		if (disposed) return;
		snapshot = { workflow, isLoading, isDispatching, error };
		for (const listener of listeners) {
			listener();
		}
	}

	// Eagerly load initial state
	transport
		.load(id)
		.then((stored) => {
			if (disposed) return;
			if (stored) {
				const restored = definition.restore(stored.snapshot);
				if (restored.ok) {
					workflow = restored.workflow;
					version = stored.version;
				}
			}
			isLoading = false;
			notify();
		})
		.catch((err) => {
			if (disposed) return;
			// biome-ignore lint/suspicious/noExplicitAny: PipelineError shape constructed for transport errors
			error = {
				category: "unexpected",
				error: err,
				message: err instanceof Error ? err.message : String(err),
			} as any;
			isLoading = false;
			notify();
		});

	// Subscribe to live updates
	const subscription: TransportSubscription = transport.subscribe(
		id,
		(message: BroadcastMessage) => {
			if (disposed) return;
			const restored = definition.restore(message.snapshot);
			if (restored.ok) {
				workflow = restored.workflow;
				version = message.version;
				error = null;
				notify();
			}
		},
	);

	const dispatch = async <C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>> => {
		if (isLoading) {
			return {
				ok: false,
				error: {
					category: "unexpected",
					error: new Error("Cannot dispatch while loading"),
					message: "Cannot dispatch while loading",
				},
			} as DispatchResult<TConfig>;
		}

		isDispatching = true;
		notify();

		const result = await transport.dispatch(
			id,
			{ type: command as string, payload },
			version,
		);

		if (result.ok) {
			const restored = definition.restore(result.snapshot);
			if (restored.ok) {
				workflow = restored.workflow;
				version = result.version;
				error = null;
				isDispatching = false;
				notify();
				return {
					ok: true,
					workflow: restored.workflow,
					events: result.events,
				} as DispatchResult<TConfig>;
			}
		}

		// Error path
		// biome-ignore lint/suspicious/noExplicitAny: TransportError mapped to PipelineError shape
		error = (result.ok ? null : result.error) as any;
		isDispatching = false;
		notify();
		return {
			ok: false,
			error: error ?? {
				category: "unexpected",
				error: new Error("Transport error"),
				message: "Transport error",
			},
		} as DispatchResult<TConfig>;
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
		cleanup() {
			disposed = true;
			subscription.unsubscribe();
		},
	};
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @rytejs/react run test -- __tests__/client.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/client.ts packages/react/__tests__/client.test.ts && git commit -m "feat(react): add createWorkflowClient for remote workflow stores"
```

---

### Task 5: Update exports, build, and verify

Wire up the new export and verify everything.

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add `createWorkflowClient` to exports**

In `packages/react/src/index.ts`, add:

```ts
export { createWorkflowClient } from "./client.js";
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm --filter @rytejs/react run test
```

Expected: All tests pass.

- [ ] **Step 3: Typecheck**

```bash
cd packages/react && npx tsc --noEmit
```

Expected: Clean.

- [ ] **Step 4: Build**

```bash
pnpm --filter @rytejs/react run build
```

Expected: Build succeeds. `dist/` contains `createWorkflowClient` export.

- [ ] **Step 5: Lint**

```bash
pnpm biome check packages/react/
```

Expected: Clean (or autofix).

- [ ] **Step 6: Commit**

```bash
git add packages/react/ && git commit -m "feat(react): export createWorkflowClient from package"
```

---

### Task 6: Update docs snippet and typecheck

Update the react docs to reflect the new API.

**Files:**
- Modify: `docs/snippets/guide/react.ts`
- Modify: `docs/guide/react.md`

- [ ] **Step 1: Update `react.ts` snippet**

In `docs/snippets/guide/react.ts`:

1. Remove `WorkflowStoreOptions` `transport` field from the declared interface (around line 73)
2. Replace the `#transport-store` region to use `createWorkflowClient` imported from `@rytejs/react`:

```ts
// #region transport-store
import { createWorkflowClient } from "@rytejs/react";

const exampleTransport: Transport = {
	async load(id) {
		throw new Error(`Not implemented: load(${id})`);
	},
	async dispatch(id, command, expectedVersion) {
		throw new Error(`Not implemented: dispatch(${id})`);
	},
	subscribe(id, callback) {
		return { unsubscribe() {} };
	},
};

const wfClient = createWorkflowClient(exampleTransport);
const transportStore = wfClient.connect(taskWorkflow, "task-1");

// Dispatch goes through the server instead of locally
await transportStore.dispatch("Start", { assignee: "alice" });

// Incoming broadcasts update the store automatically
// #endregion transport-store
```

Note: Since there are already imports at the top of the file, place the `createWorkflowClient` import with the other imports at the top, not inside the region. Also add `load` to the `Transport` interface in the `WorkflowStoreOptions` area, or import `Transport` from `@rytejs/react` which now includes `load`.

3. Update `#transport-cleanup` region — unchanged, `transportStore.cleanup()` still works.

- [ ] **Step 2: Update `react.md` Transport section**

In `docs/guide/react.md`, update the Transport section to reference `createWorkflowClient`:

```markdown
## Transport

Use `createWorkflowClient` to connect to a server-backed workflow. Commands dispatch through the server, and broadcasts push updates back to the client.

<<< @/snippets/guide/react.ts#transport-store

Transport mode requires an `id` — the server needs to know which workflow to operate on.
```

Remove the "Next Steps" link to `/guide/transports` if still present.

- [ ] **Step 3: Typecheck doc snippets**

```bash
pnpm --filter @rytejs/core run build && pnpm --filter @rytejs/react run build && pnpm --filter @rytejs/docs typecheck
```

Expected: Passes.

- [ ] **Step 4: Commit**

```bash
git add docs/ && git commit -m "docs: update react docs for createWorkflowClient API"
```

---

### Task 7: Full verification

**Files:** None — verification only.

- [ ] **Step 1: Run full check**

```bash
pnpm run check
```

Expected: Typecheck + test + lint all pass across all packages.

- [ ] **Step 2: Push**

```bash
git push
```
