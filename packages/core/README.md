<p align="center">
  <img src="https://raw.githubusercontent.com/helico-tech/rytejs/master/docs/public/logo.svg" width="120" alt="Ryte" />
</p>

<h1 align="center">@rytejs/core</h1>

<p align="center">Type-safe workflow engine driven by Standard Schema — works with Zod, Valibot, and ArkType.</p>

<p align="center">
  <a href="https://github.com/helico-tech/rytejs/actions/workflows/ci.yml"><img src="https://github.com/helico-tech/rytejs/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@rytejs/core"><img src="https://img.shields.io/npm/v/@rytejs/core" alt="npm" /></a>
</p>

## Why Ryte?

- **Fully typed from definition to dispatch** — declare states, commands, events, and errors with any [Standard Schema](https://standardschema.dev) validator. TypeScript infers everything automatically.
- **Checking `workflow.state` narrows `workflow.data`** — discriminated unions, not type casts.
- **`ctx.error()` is type-checked** — only raise error codes that exist in your definition, with the correct data shape.
- **Koa-style middleware** — global, state-scoped, and inline middleware, onion model.
- **Composable routers** — split handlers across files, merge via `.use()`.
- **Zero validator lock-in** — pick Zod, Valibot, or ArkType; mix them per state if you want. Core has no runtime dependency on any validator.

## Install

```bash
# No required peers. Bring your own validator:
pnpm add @rytejs/core zod
# or
pnpm add @rytejs/core valibot
# or
pnpm add @rytejs/core arktype
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

const router = new WorkflowRouter(taskWorkflow).state("Todo", ({ on }) => {
  on("Complete", ({ data, workflow, error, transition, emit }) => {
    if (!data.assignee) {
      error("NotAssigned", { title: data.title });
    }
    transition("Done", { title: data.title, completedAt: new Date() });
    emit("TaskCompleted", { taskId: workflow.id });
  });
});

const task = taskWorkflow.createWorkflow("task-1", {
  initialState: "Todo",
  data: { title: "Read the docs", assignee: "alice" },
});

const result = await router.dispatch(task, "Complete", {});

if (result.ok) {
  console.log(result.workflow.state); // "Done"
  console.log(result.events[0]?.type); // "TaskCompleted"
} else if (result.error.category === "domain") {
  console.log(result.error.code); // "NotAssigned"
}
```

## Using a different validator

The same workflow expressed with Valibot — identical DSL, identical types:

```ts
import * as v from "valibot";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";

const taskWorkflow = defineWorkflow("task", {
  states: {
    Todo: v.object({ title: v.string(), assignee: v.optional(v.string()) }),
    Done: v.object({ title: v.string(), completedAt: v.date() }),
  },
  commands: { Complete: v.object({}) },
  events: { TaskCompleted: v.object({ taskId: v.string() }) },
  errors: { NotAssigned: v.object({ title: v.string() }) },
});
```

ArkType works identically via `type({...})`. Any validator that implements [Standard Schema v1](https://standardschema.dev) is supported — no adapters required.

## Type Safety Highlights

Every part of the API is fully typed with zero manual annotations:

- **State names** — `router.state("Todo", ...)` only accepts states from your definition
- **Command names** — `on("Complete", ...)` only accepts commands from your definition
- **Payload types** — `command.payload` is typed from the command's schema
- **State data** — `data` is typed from the current state's schema
- **Transitions** — `transition("Done", data)` validates that `data` matches the target state's schema
- **Events** — `emit("TaskCompleted", data)` validates both type and data against event schemas
- **Errors** — `error("NotAssigned", data)` only accepts error codes from your definition with matching data
- **Discriminated unions** — `if (workflow.state === "Todo") { workflow.data.title }` narrows automatically

## Documentation

- [Getting Started](https://helico-tech.github.io/rytejs/guide/getting-started)
- [Defining Workflows](https://helico-tech.github.io/rytejs/guide/defining-workflows)
- [Routing Commands](https://helico-tech.github.io/rytejs/guide/routing-commands)
- [Server Fields](https://helico-tech.github.io/rytejs/guide/server-fields)
- [State Groups](https://helico-tech.github.io/rytejs/guide/state-groups)
- [API Reference](https://helico-tech.github.io/rytejs/api/)

## License

MIT
