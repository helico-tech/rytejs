# @rytejs/core

Type-safe workflow engine with Zod validation and middleware pipelines.

![CI](https://github.com/helico-tech/rytejs/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/@rytejs/core)

## Quick Example

```ts
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";

const taskWorkflow = defineWorkflow("task", {
  states: {
    Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
    Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
  },
  commands: {
    Complete: z.object({}),
  },
  events: {
    TaskCompleted: z.object({ taskId: z.string() }),
  },
  errors: {
    NotAssigned: z.object({ title: z.string() }),
  },
});

const router = new WorkflowRouter(taskWorkflow);

router.state("Todo", (state) => {
  state.on("Complete", (ctx) => {
    if (!ctx.data.assignee) {
      ctx.error({ code: "NotAssigned", data: { title: ctx.data.title } });
    }
    ctx.transition("Done", {
      title: ctx.data.title,
      completedAt: new Date(),
    });
    ctx.emit({ type: "TaskCompleted", data: { taskId: ctx.workflow.id } });
  });
});

const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "Todo",
  data: { title: "Read the docs", assignee: "alice" },
});

const result = await router.dispatch(task, {
  type: "Complete",
  payload: {},
});

if (result.ok) {
  console.log(result.workflow.state); // "Done"
  console.log(result.events[0]?.type); // "TaskCompleted"
} else if (result.error.category === "domain") {
  console.log(result.error.code); // "NotAssigned"
}
```

## Documentation

- [Getting Started](https://helico-tech.github.io/rytejs/guide/getting-started)
- [API Reference](https://helico-tech.github.io/rytejs/api/)
- [Examples](./examples/)

## Contributing

```bash
# Clone the repo
git clone https://github.com/helico-tech/rytejs.git
cd rytejs

# Install dependencies
pnpm install

# Run tests
pnpm test

# Lint
pnpm lint

# Build
pnpm build
```

## License

MIT
