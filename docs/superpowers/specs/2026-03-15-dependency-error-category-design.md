# Dependency Error Category

## Problem

When a dependency throws during dispatch (e.g., database connection fails, external API returns 500), the error is caught as `"unexpected"` — the same category as a handler bug like a `TypeError`. Consumers have no way to distinguish infrastructure failures from programming errors in their observability tooling.

## Solution

Add a fifth `PipelineError` category: `"dependency"`. Automatically wrap `deps` in a recursive Proxy that catches dependency call failures and surfaces them as structured errors. Zero handler code changes required.

## Design

### New error shape

```typescript
| {
	category: "dependency";
	name: string;        // top-level dep key, e.g. "db", "stripe"
	error: unknown;      // the original thrown error
	message: string;     // e.g. 'Dependency "stripe" failed: Connection refused'
}
```

`name` is the first property accessed on `deps` — e.g., `deps.stripe.charges.create()` yields `name: "stripe"`. The `message` includes the dep name for observability context. The original error is preserved in `error` for stack traces and typed catches. No method path tracking; the original error already carries that context.

### DependencyErrorSignal

New internal signal class, following the existing pattern of `DomainErrorSignal` and `ValidationError`:

```typescript
class DependencyErrorSignal extends Error {
	constructor(
		public readonly name: string,
		public readonly error: unknown,
	) {
		const original = error instanceof Error ? error.message : String(error);
		super(`Dependency "${name}" failed: ${original}`);
	}
}
```

This is an internal control flow mechanism — never exported to consumers. Thrown by the proxy, caught by the router's try-catch, converted to `{ category: "dependency" }` in the `DispatchResult`.

### Recursive Proxy wrapping

Applied in `createContext()` when `wrapDeps !== false`. The `wrapDeps` flag is stored on the router instance (from `RouterOptions`) and passed to `createContext` as a parameter. The proxy wraps the `deps` object before assigning it to `ctx.deps`.

The wrapping applies to the entire middleware chain — global, state-scoped, and inline middleware all receive the same proxied `ctx.deps`, not just handlers.

Behavior by value type:

| Access pattern | Proxy behavior |
|---|---|
| `deps.db` (object) | Return a proxy of `db`, tracking `depName = "db"` |
| `deps.db.save(data)` (function call) | Return a wrapper fn that calls `save.apply(originalTarget, args)`, catches sync errors, throws `DependencyErrorSignal` |
| `deps.db.save(data)` returns Promise | Return `result.catch(err => { throw new DependencyErrorSignal(...) })` — the chained promise replaces the original, so `await` in the handler sees the signal |
| `deps.db.users.find()` (nested) | Recursive proxy with same `depName = "db"` |
| Symbol-keyed property | Pass through via `Reflect.get` — no wrapping |
| Primitive / null | Pass through unwrapped |

Key implementation details:

- **`this` preservation**: The `get` trap returns a new wrapper function. Inside the wrapper, the original function is called via `fn.apply(target, args)` where `target` is the original (unproxied) object. This ensures class methods that use `this` internally (e.g., database clients with private fields) work correctly.
- **Async handling**: If a function call returns a thenable, the proxy returns `result.catch(err => { throw new DependencyErrorSignal(name, err) })`. The returned promise is what the handler `await`s, so the signal propagates up through the middleware stack into the router's try-catch. Fire-and-forget (non-awaited) dep calls will produce an unhandled rejection with `DependencyErrorSignal` — this is acceptable since fire-and-forget async is already problematic in handlers.
- **Symbol passthrough**: All Symbol-keyed property access (`Symbol.toPrimitive`, `Symbol.iterator`, `Symbol.toStringTag`, etc.) passes through without wrapping via `Reflect.get(target, prop, receiver)`. This avoids interference with `console.log`, `JSON.stringify`, `for...of`, and template literals.
- **Non-function, non-object properties**: Passed through without wrapping.

### Opt-out

`RouterOptions` gains a `wrapDeps` boolean, defaulting to `true`:

```typescript
interface RouterOptions {
	wrapDeps?: boolean; // default: true
}

// Usage:
const router = new WorkflowRouter(definition, deps, { wrapDeps: false });
```

Granularity is per-router only. Per-dependency-key exclusion is not supported — if Proxy wrapping causes issues with a specific dependency, disable it for the entire router.

**Trade-off**: Defaulting to `true` means wrapper functions lose referential equality (`deps.db.save !== deps.db.save` across accesses, since each `get` returns a new wrapper). This is acceptable because handlers should call methods on the dep object directly, not extract and store method references. Deps that rely on identity checks or are themselves Proxies with custom traps should opt out.

### Router catch block

The dispatch try-catch order becomes:

1. `DomainErrorSignal` → `{ category: "domain" }`
2. `ValidationError` → `{ category: "validation" }`
3. `DependencyErrorSignal` → `{ category: "dependency" }`
4. Everything else → `{ category: "unexpected" }`

`DependencyErrorSignal` is checked after domain/validation (which are intentional handler signals) but before the `"unexpected"` fallback. The `error` hook fires with the full `PipelineError`. The `dispatch:end` guarantee is unchanged — it always fires if `dispatch:start` fired.

### Testing package

`expectError` in `@rytejs/testing` (`assertions.ts`) has a hardcoded category union: `"validation" | "domain" | "router"`. This must be updated to include `"dependency"` (and `"unexpected"` for completeness). The `PipelineError` type change in core flows through to narrowing after this fix.

### Documentation updates

- `PipelineError` category docs: 4 → 5 categories (add `"dependency"`)
- Error handling guide: new "Dependency Errors" section explaining what triggers them, the proxy mechanism, and opt-out
- Hooks documentation: note that the `error` hook now receives `{ category: "dependency" }` errors
- CLAUDE.md: update "ALL FOUR" error categories to "ALL FIVE"

## Test plan

- Sync dep function throw → `{ category: "dependency", name: "<key>" }`
- Async dep function rejection → `{ category: "dependency", name: "<key>" }`
- Nested dep access (`deps.db.users.find()`) → `name: "db"`
- Handler bug (not a dep call) → still `{ category: "unexpected" }`
- `wrapDeps: false` → dep errors become `"unexpected"`
- Primitive dep property access → passes through, no proxy
- Symbol property access → passes through, no proxy
- `dispatch:end` hook fires on dependency errors
- `error` hook receives `{ category: "dependency" }` error
- `this` preservation: class instance dep methods work correctly through the proxy
- Domain error after dep call: handler catches dep error, calls `ctx.error()` → `{ category: "domain" }` (domain signal takes precedence)

## Scope

### In scope

- `DependencyErrorSignal` internal class
- Recursive Proxy wrapper utility
- `wrapDeps` option on `RouterOptions`
- Router catch block update
- `PipelineError` type update
- `expectError` category union update in `@rytejs/testing`
- Tests for the new category
- Documentation updates

### Out of scope

- Per-dependency-key opt-out
- Method path tracking (e.g., `["stripe", "charges", "create"]`)
- Handler-level control flow for dependency errors (retry, fallback)
- Wrapping deps in middleware (ctx.deps is read-only to middleware)
- Proxy caching via WeakMap (optimization — can add later if needed)
- Constructor call wrapping (`new deps.db.Model(...)`) — rare pattern, can add later
