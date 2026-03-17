# Context Keys

Context keys provide type-safe key-value storage on the dispatch context. Middleware sets values; handlers read them.

## Creating Keys

`createKey<T>(name)` creates a phantom-typed symbol. The name is for debugging only -- uniqueness comes from the underlying `Symbol`.

<<< @/snippets/guide/context-keys.ts#create-keys

Two calls to `createKey` with the same name produce different keys.

## Setting Values

Use `set(key, value)` in middleware:

<<< @/snippets/guide/context-keys.ts#set-values

The value must match the key's type parameter -- `set(UserKey, "string")` is a type error.

## Reading Values

### `get(key)` -- throws if missing

```ts
const user = get(UserKey);
// user is typed as { id: string; role: string }
// throws if UserKey was never set
```

### `getOrNull(key)` -- returns undefined if missing

```ts
const user = getOrNull(UserKey);
// user is typed as { id: string; role: string } | undefined
```

## Complete Example: Auth Middleware + Handler

<<< @/snippets/guide/context-keys.ts#complete

## When to Use Context Keys

Use context keys when middleware needs to pass computed data to handlers:

- **Auth** -- middleware authenticates, handler checks permissions
- **Request tracing** -- middleware generates a trace ID, handler includes it in events
- **Timing** -- middleware records start time, post-handler logic calculates duration

For static services that don't change per-request, prefer [dependency injection](/guide/dependency-injection) instead.
