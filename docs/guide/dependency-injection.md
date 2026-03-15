# Dependency Injection

Pass external services to your handlers through the router's dependency system.

## Providing Dependencies

Pass a deps object as the second argument to `WorkflowRouter`:

```ts
import { WorkflowRouter } from "@rytejs/core";

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

The type is inferred from the object you pass. All handlers and middleware receive the same typed `deps`.

## Accessing Dependencies

Use `deps` in any handler or middleware:

```ts
router.state("Review", ({ on }) => {
  on("Approve", async ({ deps, data, error, transition }) => {
    const canApprove = deps.reviewService.canApprove(data.reviewerId);
    if (!canApprove) {
      error({ code: "NotReviewer", data: { expected: data.reviewerId } });
    }

    transition("Published", {
      title: data.title,
      body: data.body,
      publishedAt: new Date(),
    });
  });
});
```

`deps` is fully typed -- TypeScript knows exactly what services are available.

## Complete Example

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";

// Define the workflow
const articleWorkflow = defineWorkflow("article", {
  states: {
    Draft: z.object({ title: z.string(), body: z.string().optional() }),
    Published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
  },
  commands: {
    Publish: z.object({}),
  },
  events: {
    ArticlePublished: z.object({ articleId: z.string(), notifiedSubscribers: z.number() }),
  },
  errors: {
    BodyRequired: z.object({}),
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
router.state("Draft", ({ on }) => {
  on("Publish", async ({ data, deps, error, transition, emit, workflow }) => {
    if (!data.body) {
      error({ code: "BodyRequired", data: {} });
    }

    const count = await deps.notifier.notifySubscribers(workflow.id);

    transition("Published", {
      title: data.title,
      body: data.body!,
      publishedAt: new Date(),
    });

    emit({
      type: "ArticlePublished",
      data: { articleId: workflow.id, notifiedSubscribers: count },
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
