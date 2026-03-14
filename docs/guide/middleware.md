# Middleware

Middleware uses the Koa-style onion model. Each middleware calls `next()` to pass control inward, then can run logic after the inner layers complete.

## Three Levels

### Global Middleware

Added with `router.use()`. Wraps every dispatch regardless of state.

```ts
router.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.command.type} took ${Date.now() - start}ms`);
});
```

### State-Scoped Middleware

Added with `state.use()` inside a `.state()` block. Only runs for handlers registered in that state.

```ts
router.state("Draft", (state) => {
  state.use(async (ctx, next) => {
    console.log("entering Draft handler");
    await next();
  });

  state.on("UpdateDraft", (ctx) => {
    ctx.update({ title: ctx.command.payload.title });
  });
});
```

State middleware does **not** run for wildcard handlers, even if the workflow is in that state.

### Inline Middleware

Passed as extra arguments to `state.on()` before the handler. Runs only for that specific command.

```ts
router.state("Draft", (state) => {
  state.on(
    "Submit",
    async (ctx, next) => {
      if (!ctx.data.body) {
        ctx.error({ code: "BodyRequired", data: {} });
      }
      await next();
    },
    (ctx) => {
      ctx.transition("Review", {
        title: ctx.data.title,
        body: ctx.data.body!,
        reviewerId: ctx.command.payload.reviewerId,
      });
    },
  );
});
```

## Execution Order

The full onion executes in this order:

```
global-before
  state-before
    inline-before
      handler
    inline-after
  state-after
global-after
```

Verified by test:

```ts
const log: string[] = [];

router.use(async (_ctx, next) => {
  log.push("global-before");
  await next();
  log.push("global-after");
});

router.state("Draft", (state) => {
  state.use(async (_ctx, next) => {
    log.push("state-before");
    await next();
    log.push("state-after");
  });

  state.on(
    "SetTitle",
    async (_ctx, next) => {
      log.push("inline-before");
      await next();
      log.push("inline-after");
    },
    (ctx) => {
      log.push("handler");
      ctx.update({ title: ctx.command.payload.title });
    },
  );
});

await router.dispatch(workflow, { type: "SetTitle", payload: { title: "x" } });
// log: ["global-before", "state-before", "inline-before", "handler",
//        "inline-after", "state-after", "global-after"]
```

## Example: Auth Middleware

```ts
import { createKey } from "@rytejs/core";

const UserKey = createKey<{ id: string; role: string }>("user");

router.use(async (ctx, next) => {
  // In a real app, extract user from a token or session
  ctx.set(UserKey, { id: "user-1", role: "admin" });
  await next();
});

router.state("Review", (state) => {
  state.on("Approve", (ctx) => {
    const user = ctx.get(UserKey);
    if (user.role !== "admin") {
      ctx.error({ code: "Unauthorized", data: { required: "admin" } });
    }
    ctx.transition("Published", {
      title: ctx.data.title,
      body: ctx.data.body,
      publishedAt: new Date(),
    });
  });
});
```

## Example: Logging Middleware

```ts
router.use(async (ctx, next) => {
  console.log(`[${ctx.workflow.state}] ${ctx.command.type}`, ctx.command.payload);
  await next();
});
```

See [Context Keys](/guide/context-keys) for the full `createKey` / `ctx.set` / `ctx.get` API.
