# Integration Examples

## Problem

There's no guidance on how to use `@rytejs/core` in real applications — HTTP servers, message consumers, etc. Users have to figure out the load/dispatch/persist/publish pattern themselves.

## Solution

Three working example projects and one docs guide page showing how to integrate Ryte with common runtimes.

## Shared pattern

Every integration follows the same loop:

1. **Receive** a command (HTTP request, Kafka message, etc.)
2. **Load** the workflow from storage (`definition.restore(snapshot)`)
3. **Dispatch** the command (`router.dispatch(workflow, command)`)
4. **Persist** the updated workflow (`definition.snapshot(result.workflow)`)
5. **Publish** events (log, emit, forward — whatever the app needs)

All examples use an in-memory `Map<string, WorkflowSnapshot>` as the store, using `definition.snapshot()` and `definition.restore()` for serialization. This keeps examples runnable without a real database.

## Examples

### `examples/express/`

REST API with Express. Endpoints:

- `POST /workflows` — create a new workflow
- `POST /workflows/:id/dispatch` — dispatch a command
- `GET /workflows/:id` — get current workflow state

```
examples/express/
  package.json
  index.ts
```

Dependencies: `express`, `@rytejs/core`, `zod`. Dev: `tsx`, `@types/express`.

### `examples/hono/`

REST API with Hono. Same endpoints as Express.

```
examples/hono/
  package.json
  index.ts
```

Dependencies: `hono`, `@rytejs/core`, `zod`. Dev: `tsx`.

### `examples/kafka/`

KafkaJS consumer that processes workflow commands from a topic.

```
examples/kafka/
  package.json
  index.ts
```

Dependencies: `kafkajs`, `@rytejs/core`, `zod`. Dev: `tsx`.

The example shows the consumer setup with the dispatch loop. Since Kafka requires a running broker, the example includes comments explaining how to run it but is primarily a reference, not something you'd `tsx index.ts` without infrastructure.

## Docs guide

### `docs/guide/integrations.md`

Explains the pattern once with a generic example, then shows framework-specific snippets for Express, Hono, and Kafka. Links to the full example projects.

Added to the VitePress sidebar under "Advanced".

## What these are NOT

- Not separate packages — just example projects in `examples/`
- Not in the pnpm workspace — they use `workspace:*` like `examples/basic` (they reference the local source, unlike `examples/e2e`)
- Not tested in CI — they're reference code, not assertions
