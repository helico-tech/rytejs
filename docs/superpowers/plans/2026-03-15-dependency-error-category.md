# Dependency Error Category Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `"dependency"` error category to `PipelineError` so consumers can distinguish infrastructure failures from handler bugs.

**Architecture:** A recursive Proxy wraps `deps` in `createContext()`, catching errors from dependency calls and re-throwing as `DependencyErrorSignal`. The router's existing try-catch recognizes the signal and returns `{ category: "dependency" }`. Opt-out via `RouterOptions.wrapDeps`.

**Tech Stack:** TypeScript, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-dependency-error-category-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/types.ts` | Modify | Add `DependencyErrorSignal` class and `"dependency"` member to `PipelineError` union |
| `packages/core/src/wrap-deps.ts` | Create | Recursive Proxy wrapper: `wrapDeps(deps, depName?)` |
| `packages/core/src/context.ts` | Modify | Import `wrapDeps`, apply in `createContext()` when enabled |
| `packages/core/src/router.ts` | Modify | Add `wrapDeps` to `RouterOptions`, pass to `createContext`, catch `DependencyErrorSignal` |
| `packages/core/__tests__/wrap-deps.test.ts` | Create | Unit tests for the Proxy wrapper in isolation |
| `packages/core/__tests__/router.test.ts` | Modify | Integration tests for dependency errors through dispatch |
| `packages/testing/src/assertions.ts` | Modify | Add `"dependency"` and `"unexpected"` to `expectError` category union |
| `packages/testing/__tests__/assertions.test.ts` | Modify | Test `expectError` with new categories |

---

## Chunk 1: Core Types and Proxy Wrapper

### Task 1: Add `DependencyErrorSignal` and `"dependency"` to `PipelineError`

**Files:**
- Modify: `packages/core/src/types.ts:70-91` (PipelineError union)
- Modify: `packages/core/src/types.ts:129-137` (after DomainErrorSignal)

- [ ] **Step 1: Add `"dependency"` member to `PipelineError` union**

In `packages/core/src/types.ts`, add the new union member after the `"unexpected"` member (line 91):

```typescript
| {
		category: "dependency";
		name: string;
		error: unknown;
		message: string;
  };
```

The full `PipelineError` type should now have 5 members: `"validation"`, `"domain"`, `"router"`, `"unexpected"`, `"dependency"`.

- [ ] **Step 2: Add `DependencyErrorSignal` class**

In `packages/core/src/types.ts`, add after the `DomainErrorSignal` class (after line 137):

```typescript
/**
 * Thrown internally when a proxied dependency call fails.
 * Caught by the router and returned as a dependency error in {@link DispatchResult}.
 *
 * @param depName - The top-level dependency key (e.g. "db", "stripe")
 * @param error - The original error thrown by the dependency
 */
export class DependencyErrorSignal extends Error {
	constructor(
		public readonly depName: string,
		public readonly error: unknown,
	) {
		const original = error instanceof Error ? error.message : String(error);
		super(`Dependency "${depName}" failed: ${original}`);
		this.name = "DependencyErrorSignal";
	}
}
```

**NOTE:** The property is `depName` (not `name`) because `Error` already has a `name` property. The `this.name = "DependencyErrorSignal"` line sets `Error.name` for stack trace display. Using `depName` avoids the collision where `this.name` would be overwritten.

- [ ] **Step 3: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS (no consumers reference the new type yet)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat: add DependencyErrorSignal and dependency PipelineError category"
```

---

### Task 2: Implement the recursive Proxy wrapper

**Files:**
- Create: `packages/core/src/wrap-deps.ts`
- Create: `packages/core/__tests__/wrap-deps.test.ts`

- [ ] **Step 1: Write failing tests for the Proxy wrapper**

Create `packages/core/__tests__/wrap-deps.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { DependencyErrorSignal } from "../src/types.js";
import { wrapDeps } from "../src/wrap-deps.js";

describe("wrapDeps", () => {
	test("sync function that succeeds passes through", () => {
		const deps = { db: { save: (x: number) => x * 2 } };
		const wrapped = wrapDeps(deps);
		expect(wrapped.db.save(5)).toBe(10);
	});

	test("sync function that throws produces DependencyErrorSignal", () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("connection refused");
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			wrapped.db.save();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).depName).toBe("db");
			expect((err as DependencyErrorSignal).name).toBe("DependencyErrorSignal");
			expect((err as DependencyErrorSignal).message).toBe(
				'Dependency "db" failed: connection refused',
			);
			expect((err as DependencyErrorSignal).error).toBeInstanceOf(Error);
		}
	});

	test("async function that resolves passes through", async () => {
		const deps = { api: { fetch: async (x: number) => x + 1 } };
		const wrapped = wrapDeps(deps);
		await expect(wrapped.api.fetch(3)).resolves.toBe(4);
	});

	test("async function that rejects produces DependencyErrorSignal", async () => {
		const deps = {
			api: {
				fetch: async () => {
					throw new Error("timeout");
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			await wrapped.api.fetch();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).depName).toBe("api");
			expect((err as DependencyErrorSignal).message).toBe(
				'Dependency "api" failed: timeout',
			);
		}
	});

	test("nested object access tracks top-level dep name", async () => {
		const deps = {
			db: {
				users: {
					find: async () => {
						throw new Error("not found");
					},
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			await wrapped.db.users.find();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).depName).toBe("db");
			expect((err as DependencyErrorSignal).message).toBe(
				'Dependency "db" failed: not found',
			);
		}
	});

	test("primitive properties pass through unwrapped", () => {
		const deps = { config: { timeout: 5000, name: "test", enabled: true } };
		const wrapped = wrapDeps(deps);
		expect(wrapped.config.timeout).toBe(5000);
		expect(wrapped.config.name).toBe("test");
		expect(wrapped.config.enabled).toBe(true);
	});

	test("null and undefined properties pass through", () => {
		const deps = { cache: null, logger: undefined };
		const wrapped = wrapDeps(deps);
		expect(wrapped.cache).toBeNull();
		expect(wrapped.logger).toBeUndefined();
	});

	test("symbol-keyed properties pass through without wrapping", () => {
		const sym = Symbol("test");
		const obj = { [sym]: () => 42 };
		const deps = { svc: obj };
		const wrapped = wrapDeps(deps);
		expect(wrapped.svc[sym]()).toBe(42);
	});

	test("this binding is preserved for class methods", () => {
		class DB {
			#connection = "live";
			query() {
				return this.#connection;
			}
		}
		const deps = { db: new DB() };
		const wrapped = wrapDeps(deps);
		expect(wrapped.db.query()).toBe("live");
	});

	test("non-error throws are wrapped with String coercion", () => {
		const deps = {
			svc: {
				call: () => {
					throw "raw string error";
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			wrapped.svc.call();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).message).toBe(
				'Dependency "svc" failed: raw string error',
			);
			expect((err as DependencyErrorSignal).error).toBe("raw string error");
		}
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run __tests__/wrap-deps.test.ts`
Expected: FAIL — `wrapDeps` module does not exist yet

- [ ] **Step 3: Implement the Proxy wrapper**

Create `packages/core/src/wrap-deps.ts`:

```typescript
import { DependencyErrorSignal } from "./types.js";

function createDepProxy<T extends object>(obj: T, depName: string): T {
	return new Proxy(obj, {
		get(target, prop, receiver) {
			if (typeof prop === "symbol") {
				return Reflect.get(target, prop, receiver);
			}

			const value = Reflect.get(target, prop, receiver);

			if (value === null || value === undefined) {
				return value;
			}

			if (typeof value === "function") {
				return (...args: unknown[]) => {
					try {
						const result = value.apply(target, args);
						if (result != null && typeof result === "object" && typeof result.then === "function") {
							return result.catch((err: unknown) => {
								throw new DependencyErrorSignal(depName, err);
							});
						}
						return result;
					} catch (err) {
						throw new DependencyErrorSignal(depName, err);
					}
				};
			}

			if (typeof value === "object") {
				return createDepProxy(value as object, depName);
			}

			return value;
		},
	});
}

/** Wraps a deps object in a recursive Proxy that catches dependency errors. */
export function wrapDeps<T extends object>(deps: T): T {
	return new Proxy(deps, {
		get(target, prop, receiver) {
			if (typeof prop === "symbol") {
				return Reflect.get(target, prop, receiver);
			}

			const value = Reflect.get(target, prop, receiver);

			if (value === null || value === undefined) {
				return value;
			}

			const depName = String(prop);

			if (typeof value === "function") {
				return (...args: unknown[]) => {
					try {
						const result = value.apply(target, args);
						if (result != null && typeof result === "object" && typeof result.then === "function") {
							return result.catch((err: unknown) => {
								throw new DependencyErrorSignal(depName, err);
							});
						}
						return result;
					} catch (err) {
						throw new DependencyErrorSignal(depName, err);
					}
				};
			}

			if (typeof value === "object") {
				return createDepProxy(value as object, depName);
			}

			return value;
		},
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run __tests__/wrap-deps.test.ts`
Expected: PASS — all 10 tests

- [ ] **Step 5: Run lint**

Run: `npx biome check packages/core/src/wrap-deps.ts packages/core/__tests__/wrap-deps.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/wrap-deps.ts packages/core/__tests__/wrap-deps.test.ts
git commit -m "feat: implement recursive Proxy wrapper for dependency error detection"
```

---

## Chunk 2: Router Integration

### Task 3: Wire `wrapDeps` into `createContext` and add `RouterOptions.wrapDeps`

**Files:**
- Modify: `packages/core/src/context.ts:94-99` (createContext signature)
- Modify: `packages/core/src/context.ts:111` (deps assignment)
- Modify: `packages/core/src/router.ts:32-35` (RouterOptions)
- Modify: `packages/core/src/router.ts:85-91` (constructor)
- Modify: `packages/core/src/router.ts:357-362` (createContext call)

- [ ] **Step 1: Add `wrapDeps` parameter to `createContext`**

In `packages/core/src/context.ts`, add the import at the top:

```typescript
import { wrapDeps as wrapDepsProxy } from "./wrap-deps.js";
```

Change the `createContext` function signature (line 94) to accept a 5th parameter:

```typescript
export function createContext<TConfig extends WorkflowConfig, TDeps>(
	definition: WorkflowDefinition<TConfig>,
	originalWorkflow: Workflow<TConfig>,
	command: { type: string; payload: unknown },
	deps: TDeps,
	options?: { wrapDeps?: boolean },
): Context<TConfig, TDeps> {
```

Then change the `deps` line inside the context object (line 111) from:

```typescript
deps,
```

to:

```typescript
deps: (options?.wrapDeps !== false && deps != null && typeof deps === "object"
	? wrapDepsProxy(deps as object) as TDeps
	: deps),
```

- [ ] **Step 2: Add `wrapDeps` to `RouterOptions` and pass through to `createContext`**

In `packages/core/src/router.ts`, add `wrapDeps` to `RouterOptions` (line 32):

```typescript
export interface RouterOptions {
	/** Callback invoked when a lifecycle hook throws. Defaults to `console.error`. */
	onHookError?: (error: unknown) => void;
	/** Wrap deps in a Proxy to catch dependency errors. Defaults to `true`. */
	wrapDeps?: boolean;
}
```

Store it on the router class. Add a private field after `onHookError` (line 78):

```typescript
private readonly wrapDeps: boolean;
```

In the constructor (line 90), add:

```typescript
this.wrapDeps = options.wrapDeps !== false;
```

In the `dispatch` method, update the `createContext` call (lines 357-362) to pass the option:

```typescript
const ctx = createContext<TConfig, TDeps>(
	this.definition,
	workflow,
	validatedCommand,
	this.deps,
	{ wrapDeps: this.wrapDeps },
);
```

- [ ] **Step 3: Add `DependencyErrorSignal` to the router's catch block**

In `packages/core/src/router.ts`, add the import (line 19):

```typescript
import { DomainErrorSignal, ValidationError, DependencyErrorSignal } from "./types.js";
```

In the catch block (after the `ValidationError` check, line 418), add before the `else` fallback:

```typescript
} else if (err instanceof DependencyErrorSignal) {
	result = {
		ok: false as const,
		error: {
			category: "dependency" as const,
			name: err.depName,
			error: err.error,
			message: err.message,
		},
	};
}
```

Note: `err.depName` maps to `name` in the `PipelineError` shape. The signal uses `depName` to avoid colliding with `Error.name` (see Task 1).

- [ ] **Step 4: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/router.ts packages/core/src/types.ts
git commit -m "feat: wire dependency wrapping into context and router dispatch"
```

---

### Task 4: Integration tests for dependency errors through dispatch

**Files:**
- Modify: `packages/core/__tests__/router.test.ts`

- [ ] **Step 1: Write integration tests**

Add a new `describe` block to `packages/core/__tests__/router.test.ts` (at the end of the file, inside the outer describe). First check what imports are available at the top of the file and add any needed ones (like `DependencyErrorSignal` if needed for instanceof checks, though the test should check the result shape, not the signal).

```typescript
describe("dependency errors", () => {
	test("sync dep throw returns dependency error", async () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("connection refused");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.state("Draft", ({ on }) => {
			on("Publish", ({ deps }) => {
				deps.db.save();
			});
		});

		const result = await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("dependency");
			if (result.error.category === "dependency") {
				expect(result.error.name).toBe("db");
				expect(result.error.message).toBe('Dependency "db" failed: connection refused');
				expect(result.error.error).toBeInstanceOf(Error);
			}
		}
	});

	test("async dep rejection returns dependency error", async () => {
		const deps = {
			api: {
				fetch: async () => {
					throw new Error("timeout");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.state("Draft", ({ on }) => {
			on("Publish", async ({ deps }) => {
				await deps.api.fetch();
			});
		});

		const result = await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("dependency");
			if (result.error.category === "dependency") {
				expect(result.error.name).toBe("api");
			}
		}
	});

	test("nested dep access tracks top-level name", async () => {
		const deps = {
			db: {
				users: {
					find: () => {
						throw new Error("not found");
					},
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.state("Draft", ({ on }) => {
			on("Publish", ({ deps }) => {
				deps.db.users.find();
			});
		});

		const result = await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(result.ok).toBe(false);
		if (!result.ok && result.error.category === "dependency") {
			expect(result.error.name).toBe("db");
		}
	});

	test("handler bug still returns unexpected", async () => {
		const router = new WorkflowRouter(definition, {});
		router.state("Draft", ({ on }) => {
			on("Publish", () => {
				// @ts-expect-error intentional handler bug
				null.foo();
			});
		});

		const result = await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("unexpected");
		}
	});

	test("wrapDeps: false makes dep errors unexpected", async () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("connection refused");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps, { wrapDeps: false });
		router.state("Draft", ({ on }) => {
			on("Publish", ({ deps }) => {
				deps.db.save();
			});
		});

		const result = await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("unexpected");
		}
	});

	test("dispatch:end hook fires on dependency error", async () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("down");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.state("Draft", ({ on }) => {
			on("Publish", ({ deps }) => {
				deps.db.save();
			});
		});
		let hookFired = false;
		router.on("dispatch:end", () => {
			hookFired = true;
		});

		await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(hookFired).toBe(true);
	});

	test("error hook receives dependency error", async () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("down");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.state("Draft", ({ on }) => {
			on("Publish", ({ deps }) => {
				deps.db.save();
			});
		});
		let receivedError: unknown = null;
		router.on("error", (error) => {
			receivedError = error;
		});

		await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(receivedError).not.toBeNull();
		expect((receivedError as { category: string }).category).toBe("dependency");
	});

	test("domain error after catching dep error takes precedence", async () => {
		const deps = {
			db: {
				check: () => {
					throw new Error("unavailable");
				},
			},
		};
		const router = new WorkflowRouter(definition, deps);
		router.state("Draft", ({ on }) => {
			on("Publish", (ctx) => {
				try {
					ctx.deps.db.check();
				} catch {
					ctx.error({ code: "TitleRequired", data: {} });
				}
			});
		});

		const result = await router.dispatch(wf.Draft(), { type: "Publish", payload: {} });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("domain");
		}
	});
});
```

**NOTE:** These tests use `definition` and `wf.Draft()` which are the existing fixtures in `router.test.ts`. The `TitleRequired` error code exists in the test definition's errors.

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run __tests__/router.test.ts`
Expected: PASS — all existing tests plus the new dependency error tests

- [ ] **Step 3: Run the full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all 149+ tests (existing + new)

- [ ] **Step 4: Commit**

```bash
git add packages/core/__tests__/router.test.ts
git commit -m "test: add integration tests for dependency error category"
```

---

## Chunk 3: Testing Package and Cleanup

### Task 5: Update `expectError` in `@rytejs/testing`

**Files:**
- Modify: `packages/testing/src/assertions.ts:33`
- Modify: `packages/testing/__tests__/assertions.test.ts`

- [ ] **Step 1: Write a failing test for the new category**

In `packages/testing/__tests__/assertions.test.ts`, add a test that calls `expectError` with `"dependency"` and `"unexpected"` categories. Find the existing `expectError` describe block and add:

```typescript
test("narrows dependency error", () => {
	const result = {
		ok: false as const,
		error: {
			category: "dependency" as const,
			name: "db",
			error: new Error("down"),
			message: 'Dependency "db" failed: down',
		},
	};
	expectError(result, "dependency");
});

test("narrows unexpected error", () => {
	const result = {
		ok: false as const,
		error: {
			category: "unexpected" as const,
			error: new TypeError("oops"),
			message: "oops",
		},
	};
	expectError(result, "unexpected");
});
```

- [ ] **Step 2: Rebuild core (testing imports from dist)**

Run: `cd packages/core && npx tsup`
Expected: Build succeeds

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/testing && npx vitest run __tests__/assertions.test.ts`
Expected: FAIL — TypeScript error, `"dependency"` not assignable to the category union

- [ ] **Step 4: Update `expectError` category union**

In `packages/testing/src/assertions.ts` line 33, change:

```typescript
category: "validation" | "domain" | "router",
```

to:

```typescript
category: "validation" | "domain" | "router" | "dependency" | "unexpected",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/testing && npx vitest run __tests__/assertions.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full testing suite**

Run: `cd packages/testing && npx vitest run`
Expected: PASS — all 29+ tests

- [ ] **Step 7: Commit**

```bash
git add packages/testing/src/assertions.ts packages/testing/__tests__/assertions.test.ts
git commit -m "feat: add dependency and unexpected to expectError category union"
```

---

### Task 6: Update exports and run full check

**Files:**
- Verify: `packages/core/src/index.ts` — `DependencyErrorSignal` must NOT be exported (internal signal)
- Verify: `packages/core/src/index.ts` — `wrapDeps` must NOT be exported (internal utility)

- [ ] **Step 1: Verify no accidental exports**

Read `packages/core/src/index.ts` and confirm that neither `DependencyErrorSignal` nor `wrapDeps` appear in exports. If a previous task accidentally added them, remove them.

- [ ] **Step 2: Run lint on all changed files**

Run: `npx biome check packages/core/src/types.ts packages/core/src/wrap-deps.ts packages/core/src/context.ts packages/core/src/router.ts packages/testing/src/assertions.ts`
Expected: PASS

- [ ] **Step 3: Run the full workspace check**

Run: `pnpm run check`
Expected: PASS — typecheck + test + lint across all packages

- [ ] **Step 4: Commit any lint fixes if needed**

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update error category references**

In `CLAUDE.md`, find the line that says:

```
- When documenting `PipelineError` categories, include ALL FOUR: `"validation"`, `"domain"`, `"router"`, `"unexpected"`
```

Change to:

```
- When documenting `PipelineError` categories, include ALL FIVE: `"validation"`, `"domain"`, `"router"`, `"unexpected"`, `"dependency"`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for five PipelineError categories"
```

- [ ] **Step 3: Push the branch**

```bash
git push
```

---

### Task 8: Update docs site

**Files:**
- Modify: `docs/guide/error-handling.md`
- Modify: `docs/guide/hooks-and-plugins.md`

- [ ] **Step 1: Update error handling guide**

In `docs/guide/error-handling.md`:

**a)** Change line 18 from "four categories" to "five categories":

```
`PipelineError` is a discriminated union with five categories.
```

**b)** Add a new "Dependency Errors" section after "Unexpected Errors" (after line 95) and before "Router Errors":

```markdown
### Dependency Errors

When a dependency injected via the router constructor throws during dispatch, the error is automatically caught and returned as a `"dependency"` error. This lets you distinguish infrastructure failures (database down, API timeout) from handler bugs (`"unexpected"`).

Dependencies are wrapped in a Proxy by default — no handler code changes required.

```ts
if (!result.ok && result.error.category === "dependency") {
	console.log(result.error.name);    // top-level dep key, e.g. "db"
	console.log(result.error.message); // 'Dependency "db" failed: Connection refused'
	console.log(result.error.error);   // the original thrown error
}
```

To disable dependency wrapping:

```ts
const router = new WorkflowRouter(definition, deps, { wrapDeps: false });
```

With wrapping disabled, dependency errors fall through to `"unexpected"`.
```

**c)** Add `"dependency"` case to the switch statement in "Narrowing Error Types" (after the `"router"` case, before `"unexpected"`):

```typescript
    case "dependency":
      // result.error.name, result.error.error, result.error.message
      console.log("Dependency failed:", result.error.name);
      break;
```

- [ ] **Step 2: Update hooks documentation**

In `docs/guide/hooks-and-plugins.md`, update the Hook Events table (line 42). Change the `error` row from:

```
| `error` | On domain or validation error | `(error, ctx)` |
```

to:

```
| `error` | On domain, validation, dependency, or unexpected error | `(error, ctx)` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/guide/error-handling.md docs/guide/hooks-and-plugins.md
git commit -m "docs: add dependency error category to error handling and hooks guides"
```

- [ ] **Step 4: Push the branch**

```bash
git push
```
