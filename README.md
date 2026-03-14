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
    todo: z.object({ title: z.string() }),
    done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
  },
  commands: {
    complete: z.object({}),
  },
  events: {
    TaskCompleted: z.object({ taskId: z.string() }),
  },
  errors: {},
});

const router = new WorkflowRouter(taskWorkflow);

router.state("todo", (state) => {
  state.on("complete", (ctx) => {
    ctx.transition("done", {
      title: ctx.data.title,
      completedAt: new Date(),
    });
    ctx.emit({ type: "TaskCompleted", data: { taskId: ctx.workflow.id } });
  });
});

const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "todo",
  data: { title: "Read the docs" },
});

const result = await router.dispatch(task, {
  type: "complete",
  payload: {},
});

if (result.ok) {
  console.log(result.workflow.state); // "done"
  console.log(result.events[0]?.type); // "TaskCompleted"
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
