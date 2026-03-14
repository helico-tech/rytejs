# Dependency Injection

Pass external services to your handlers through the router's dependency system.

## Providing Dependencies

Pass a deps object as the second argument to `WorkflowRouter`:

```ts
import { WorkflowRouter } from "@ryte/core";

type Deps = {
  db: Database;
  emailService: EmailService;
};

const deps: Deps = {
  db: new Database(),
  emailService: new EmailService(),
};

const router = new WorkflowRouter(taskWorkflow, deps);
```

The type is inferred from the object you pass. All handlers and middleware receive the same typed `ctx.deps`.

## Accessing Dependencies

Use `ctx.deps` in any handler or middleware:

```ts
router.state("review", (state) => {
  state.on("approve", async (ctx) => {
    const canApprove = ctx.deps.reviewService.canApprove(ctx.data.reviewerId);
    if (!canApprove) {
      ctx.error({ code: "notReviewer", data: { expected: ctx.data.reviewerId } });
    }

    ctx.transition("published", {
      title: ctx.data.title,
      body: ctx.data.body,
      publishedAt: new Date(),
    });
  });
});
```

`ctx.deps` is fully typed -- TypeScript knows exactly what services are available.

## Complete Example

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@ryte/core";

// Define the workflow
const articleWorkflow = defineWorkflow("article", {
  states: {
    draft: z.object({ title: z.string(), body: z.string().optional() }),
    published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
  },
  commands: {
    publish: z.object({}),
  },
  events: {
    ArticlePublished: z.object({ articleId: z.string(), notifiedSubscribers: z.number() }),
  },
  errors: {
    bodyRequired: z.object({}),
  },
});

// Define dependencies
type Deps = {
  notifier: { notifySubscribers(articleId: string): Promise<number> };
};

const router = new WorkflowRouter(articleWorkflow, {
  notifier: {
    async notifySubscribers(articleId: string) {
      // send emails, push notifications, etc.
      return 42;
    },
  },
});

// Use deps in handler
router.state("draft", (state) => {
  state.on("publish", async (ctx) => {
    if (!ctx.data.body) {
      ctx.error({ code: "bodyRequired", data: {} });
    }

    const count = await ctx.deps.notifier.notifySubscribers(ctx.workflow.id);

    ctx.transition("published", {
      title: ctx.data.title,
      body: ctx.data.body!,
      publishedAt: new Date(),
    });

    ctx.emit({
      type: "ArticlePublished",
      data: { articleId: ctx.workflow.id, notifiedSubscribers: count },
    });
  });
});
```

## Testing with Mock Dependencies

Dependency injection makes testing straightforward -- pass mocks instead of real services:

```ts
const mockRouter = new WorkflowRouter(articleWorkflow, {
  notifier: {
    async notifySubscribers() {
      return 0; // no-op in tests
    },
  },
});
```
