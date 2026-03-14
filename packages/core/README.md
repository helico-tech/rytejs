# @rytejs/core

Type-safe workflow engine with Zod validation and middleware pipelines.

[![CI](https://github.com/helico-tech/rytejs/actions/workflows/ci.yml/badge.svg)](https://github.com/helico-tech/rytejs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@rytejs/core)](https://www.npmjs.com/package/@rytejs/core)

## Why Ryte?

- **Fully typed from definition to dispatch** -- define your states, commands, events, and errors with Zod schemas. TypeScript infers everything automatically. State names, command payloads, event data, error codes -- all with full autocompletion, no manual type annotations.
- **Checking `workflow.state` narrows `workflow.data`** -- TypeScript knows exactly which data shape each state has. Discriminated unions, not type casts.
- **`ctx.error()` is type-checked** -- you can only raise error codes that exist in your definition, with the correct data shape. Domain failures are part of the contract.
- **Koa-style middleware** -- global, state-scoped, and inline middleware with the onion model. Add auth, logging, or validation without touching handlers.
- **Fluent builder API** -- chain `.state()`, `.on()`, `.use()` calls. Every method returns `this`.
- **Composable routers** -- split handlers across files and compose them with `.use()`. Routers are routers.
- **Zero platform lock-in** -- pure logic with no runtime dependencies beyond Zod. Works on Node.js, Bun, and Deno.

## Install

```bash
pnpm add @rytejs/core zod
```

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

const router = new WorkflowRouter(taskWorkflow)
  .state("Todo", (state) => {
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

## Type Safety Highlights

Every part of the API is fully typed with zero manual annotations:

- **State names** -- `router.state("Todo", ...)` only accepts states from your definition
- **Command names** -- `state.on("Complete", ...)` only accepts commands from your definition
- **Payload types** -- `ctx.command.payload` is typed based on the command's Zod schema
- **State data** -- `ctx.data` is typed based on the current state's Zod schema
- **Transitions** -- `ctx.transition("Done", data)` validates that `data` matches the target state's schema
- **Events** -- `ctx.emit({ type, data })` validates both type and data against event schemas
- **Errors** -- `ctx.error({ code, data })` only accepts error codes from your definition with matching data
- **Discriminated unions** -- `if (workflow.state === "Todo") { workflow.data.title }` narrows automatically

## Documentation

- [Getting Started](https://helico-tech.github.io/rytejs/guide/getting-started)
- [Defining Workflows](https://helico-tech.github.io/rytejs/guide/defining-workflows)
- [Routing Commands](https://helico-tech.github.io/rytejs/guide/routing-commands)
- [API Reference](https://helico-tech.github.io/rytejs/api/)

## License

MIT
