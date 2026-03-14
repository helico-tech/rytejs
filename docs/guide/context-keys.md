# Context Keys

Context keys provide type-safe key-value storage on the dispatch context. Middleware sets values; handlers read them.

## Creating Keys

`createKey<T>(name)` creates a phantom-typed symbol. The name is for debugging only -- uniqueness comes from the underlying `Symbol`.

```ts
import { createKey } from "@ryte/core";

const UserKey = createKey<{ id: string; role: string }>("user");
const RequestIdKey = createKey<string>("requestId");
```

Two calls to `createKey` with the same name produce different keys.

## Setting Values

Use `ctx.set(key, value)` in middleware:

```ts
router.use(async (ctx, next) => {
  ctx.set(UserKey, { id: "user-1", role: "admin" });
  ctx.set(RequestIdKey, crypto.randomUUID());
  await next();
});
```

The value must match the key's type parameter -- `ctx.set(UserKey, "string")` is a type error.

## Reading Values

### `ctx.get(key)` -- throws if missing

```ts
const user = ctx.get(UserKey);
// user is typed as { id: string; role: string }
// throws if UserKey was never set
```

### `ctx.getOrNull(key)` -- returns undefined if missing

```ts
const user = ctx.getOrNull(UserKey);
// user is typed as { id: string; role: string } | undefined
```

## Complete Example: Auth Middleware + Handler

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter, createKey } from "@ryte/core";

// 1. Define a typed key
const AuthKey = createKey<{ userId: string; role: "viewer" | "editor" | "admin" }>("auth");

// 2. Define workflow
const articleWorkflow = defineWorkflow("article", {
  states: {
    draft: z.object({ title: z.string(), body: z.string().optional() }),
    published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
  },
  commands: {
    publish: z.object({}),
  },
  events: {
    ArticlePublished: z.object({ articleId: z.string(), publishedBy: z.string() }),
  },
  errors: {
    unauthorized: z.object({ required: z.string() }),
    bodyRequired: z.object({}),
  },
});

// 3. Create router
const router = new WorkflowRouter(articleWorkflow);

// 4. Auth middleware sets the key
router.use(async (ctx, next) => {
  // In a real app: validate JWT, look up session, etc.
  const auth = { userId: "user-1", role: "editor" as const };
  ctx.set(AuthKey, auth);
  await next();
});

// 5. Handler reads the key
router.state("draft", (state) => {
  state.on("publish", (ctx) => {
    const auth = ctx.get(AuthKey);

    if (auth.role === "viewer") {
      ctx.error({ code: "unauthorized", data: { required: "editor" } });
    }

    if (!ctx.data.body) {
      ctx.error({ code: "bodyRequired", data: {} });
    }

    ctx.transition("published", {
      title: ctx.data.title,
      body: ctx.data.body!,
      publishedAt: new Date(),
    });

    ctx.emit({
      type: "ArticlePublished",
      data: { articleId: ctx.workflow.id, publishedBy: auth.userId },
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
