# Context Keys

Context keys provide type-safe key-value storage on the dispatch context. Middleware sets values; handlers read them.

## Creating Keys

`createKey<T>(name)` creates a phantom-typed symbol. The name is for debugging only -- uniqueness comes from the underlying `Symbol`.

```ts
import { createKey } from "@rytejs/core";

const UserKey = createKey<{ id: string; role: string }>("user");
const RequestIdKey = createKey<string>("requestId");
```

Two calls to `createKey` with the same name produce different keys.

## Setting Values

Use `set(key, value)` in middleware:

```ts
router.use(async ({ set }, next) => {
  set(UserKey, { id: "user-1", role: "admin" });
  set(RequestIdKey, crypto.randomUUID());
  await next();
});
```

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

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter, createKey } from "@rytejs/core";

// 1. Define a typed key
const AuthKey = createKey<{ userId: string; role: "viewer" | "editor" | "admin" }>("auth");

// 2. Define workflow
const articleWorkflow = defineWorkflow("article", {
  states: {
    Draft: z.object({ title: z.string(), body: z.string().optional() }),
    Published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
  },
  commands: {
    Publish: z.object({}),
  },
  events: {
    ArticlePublished: z.object({ articleId: z.string(), publishedBy: z.string() }),
  },
  errors: {
    Unauthorized: z.object({ required: z.string() }),
    BodyRequired: z.object({}),
  },
});

// 3. Create router
const router = new WorkflowRouter(articleWorkflow);

// 4. Auth middleware sets the key
router.use(async ({ set }, next) => {
  // In a real app: validate JWT, look up session, etc.
  const auth = { userId: "user-1", role: "editor" as const };
  set(AuthKey, auth);
  await next();
});

// 5. Handler reads the key
router.state("Draft", ({ on }) => {
  on("Publish", ({ get, error, data, transition, emit, workflow }) => {
    const auth = get(AuthKey);

    if (auth.role === "viewer") {
      error({ code: "Unauthorized", data: { required: "editor" } });
    }

    if (!data.body) {
      error({ code: "BodyRequired", data: {} });
    }

    transition("Published", {
      title: data.title,
      body: data.body!,
      publishedAt: new Date(),
    });

    emit({
      type: "ArticlePublished",
      data: { articleId: workflow.id, publishedBy: auth.userId },
    });
  });
});
```

## When to Use Context Keys

Use context keys when middleware needs to pass computed data to handlers:

- **Auth** -- middleware authenticates, handler checks permissions
- **Request tracing** -- middleware generates a trace ID, handler includes it in events
- **Timing** -- middleware records start time, post-handler logic calculates duration

For static services that don't change per-request, prefer [dependency injection](/guide/dependency-injection) instead.
