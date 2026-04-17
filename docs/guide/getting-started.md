# Getting Started

Install Ryte and have a working workflow in under 2 minutes.

## Installation

Ryte has no required peer dependencies — pick whichever [Standard Schema](https://standardschema.dev) validator you prefer:

```bash
# Zod
pnpm add @rytejs/core zod
# Valibot
pnpm add @rytejs/core valibot
# ArkType
pnpm add @rytejs/core arktype
```

The examples in this guide use Zod, but the same DSL works identically with any Standard Schema validator. See the [README](https://github.com/helico-tech/rytejs#using-a-different-validator) for a Valibot example.

## Define a Workflow

A workflow has states (schemas), commands (intents that trigger logic), events (side effects), and errors (typed domain failures).

<<< @/snippets/guide/getting-started.ts#define

All four config keys — `states`, `commands`, `events`, `errors` — are required. Errors define your domain failures upfront so they're part of the contract, not hidden inside handlers.

## Create a Router and Handle Commands

All methods return `this`, so you can chain `.state()` and `.on()` calls fluently:

<<< @/snippets/guide/getting-started.ts#router

`error()` halts execution and rolls back all mutations. The error code and data are validated against the schema you defined.

## Dispatch and Check the Result

<<< @/snippets/guide/getting-started.ts#dispatch

`result.ok` is `true` when the command succeeds. The returned `workflow` is the updated snapshot, and `events` contains all events emitted during the dispatch. When `result.ok` is `false`, `result.error` tells you what went wrong — validation failure, domain error, or missing handler.

## Next Steps

- [Concepts](/guide/concepts) — understand the mental model
- [Defining Workflows](/guide/defining-workflows) — schemas, states, commands in depth
- [Routing Commands](/guide/routing-commands) — handlers, wildcards, multi-state
