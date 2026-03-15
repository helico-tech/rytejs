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
	message: string;     // stringified from original error
}
```

`name` is the first property accessed on `deps` — e.g., `deps.stripe.charges.create()` yields `name: "stripe"`. The original error is preserved in `error` for stack traces and typed catches. No method path tracking; the original error already carries that context.

### DependencyErrorSignal

New internal signal class, following the existing pattern of `DomainErrorSignal` and `ValidationError`:

```typescript
class DependencyErrorSignal extends Error {
	constructor(
		public readonly name: string,
		public readonly error: unknown,
	) {
		const message = error instanceof Error ? error.message : String(error);
		super(message);
	}
}
```

This is an internal control flow mechanism — never exported to consumers. Thrown by the proxy, caught by the router's try-catch, converted to `{ category: "dependency" }` in the `DispatchResult`.

### Recursive Proxy wrapping

Applied in `createContext()` when `wrapDeps !== false`. The proxy wraps the `deps` object before assigning it to `ctx.deps`.

Behavior by value type:

| Access pattern | Proxy behavior |
|---|---|
| `deps.db` (object) | Return a proxy of `db`, tracking `depName = "db"` |
| `deps.db.save(data)` (function call) | Call `save.apply(originalTarget, args)`, catch errors, throw `DependencyErrorSignal` |
| `deps.db.save(data)` returns Promise | Attach `.catch()` that throws `DependencyErrorSignal` |
| `deps.db.users.find()` (nested) | Recursive proxy with same `depName = "db"` |
| Primitive / null | Pass through unwrapped |

Key implementation details:

- **`this` preservation**: Functions are called via `fn.apply(target, args)` where `target` is the original (unproxied) object. This ensures class methods that reference `this` internally (e.g., database clients) work correctly.
- **Async handling**: If a function returns a thenable, `.catch()` is attached to convert rejections into `DependencyErrorSignal` throws.
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

### Router catch block

The dispatch try-catch order becomes:

1. `DomainErrorSignal` → `{ category: "domain" }`
2. `ValidationError` → `{ category: "validation" }`
3. `DependencyErrorSignal` → `{ category: "dependency" }`
4. Everything else → `{ category: "unexpected" }`

`DependencyErrorSignal` is checked after domain/validation (which are intentional handler signals) but before the `"unexpected"` fallback. The `error` hook fires with the full `PipelineError`. The `dispatch:end` guarantee is unchanged — it always fires if `dispatch:start` fired.

### Testing package

No changes to `@rytejs/testing` are required. `expectError` already works by checking `category` on `PipelineError`, and the type change flows through automatically since the testing package depends on core's types.

### Documentation updates

- `PipelineError` category docs: 4 → 5 categories (add `"dependency"`)
- Error handling guide: new "Dependency Errors" section explaining what triggers them, the proxy mechanism, and opt-out
- CLAUDE.md: update "ALL FOUR" error categories to "ALL FIVE"

## Scope

### In scope

- `DependencyErrorSignal` internal class
- Recursive Proxy wrapper utility
- `wrapDeps` option on `RouterOptions`
- Router catch block update
- `PipelineError` type update
- Tests for the new category
- Documentation updates

### Out of scope

- Per-dependency-key opt-out
- Method path tracking (e.g., `["stripe", "charges", "create"]`)
- Handler-level control flow for dependency errors (retry, fallback)
- Wrapping deps in middleware (ctx.deps is read-only to middleware)
