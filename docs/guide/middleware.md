# Middleware

Middleware uses the Koa-style onion model. Each middleware calls `next()` to pass control inward, then can run logic after the inner layers complete.

## Three Levels

### Global Middleware

Added with `router.use()`. Wraps every dispatch regardless of state.

```ts
router.use(async ({ command }, next) => {
  const start = Date.now();
  await next();
  console.log(`${command.type} took ${Date.now() - start}ms`);
});
```

### State-Scoped Middleware

Added with `use()` inside a `.state()` block. Only runs for handlers registered in that state.

```ts
router.state("Draft", ({ on, use }) => {
  use(async (_ctx, next) => {
    console.log("entering Draft handler");
    await next();
  });

  on("UpdateDraft", ({ command, update }) => {
    update({ title: command.payload.title });
  });
});
```

State middleware does **not** run for wildcard handlers, even if the workflow is in that state.

### Inline Middleware

Passed as extra arguments to `on()` before the handler. Runs only for that specific command.

```ts
router.state("Draft", ({ on }) => {
  on(
    "Submit",
    async ({ data, error }, next) => {
      if (!data.body) {
        error({ code: "BodyRequired", data: {} });
      }
      await next();
    },
    ({ data, command, transition }) => {
      transition("Review", {
        title: data.title,
        body: data.body!,
        reviewerId: command.payload.reviewerId,
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

router.state("Draft", ({ on, use }) => {
  use(async (_ctx, next) => {
    log.push("state-before");
    await next();
    log.push("state-after");
  });

  on(
    "SetTitle",
    async (_ctx, next) => {
      log.push("inline-before");
      await next();
      log.push("inline-after");
    },
    ({ command, update }) => {
      log.push("handler");
      update({ title: command.payload.title });
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

router.use(async ({ set }, next) => {
  // In a real app, extract user from a token or session
  set(UserKey, { id: "user-1", role: "admin" });
  await next();
});

router.state("Review", ({ on }) => {
  on("Approve", ({ get, error, data, transition }) => {
    const user = get(UserKey);
    if (user.role !== "admin") {
      error({ code: "Unauthorized", data: { required: "admin" } });
    }
    transition("Published", {
      title: data.title,
      body: data.body,
      publishedAt: new Date(),
    });
  });
});
```

## Example: Logging Middleware

```ts
router.use(async ({ workflow, command }, next) => {
  console.log(`[${workflow.state}] ${command.type}`, command.payload);
  await next();
});
```

See [Context Keys](/guide/context-keys) for the full `createKey` / `set` / `get` API.
