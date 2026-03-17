# Worker

The [Engine guide](/guide/engine) shows how to execute commands against workflow routers using `engine.execute()`. The **worker** adds persistent background processing on top: it polls a queue, executes commands, retries failures, and routes events between workflows automatically.

## When to Use

| Approach | Best for |
| --- | --- |
| `router.dispatch()` | Unit tests, pure logic |
| `engine.execute()` | Request/response APIs, synchronous execution |
| `createWorker()` | Background jobs, cross-workflow reactors, retry policies |

Use the worker when commands arrive asynchronously (queues, webhooks, scheduled jobs) or when you need automatic retry and dead-letter handling.

## Installation

::: code-group

```sh [pnpm]
pnpm add @rytejs/worker
```

```sh [npm]
npm install @rytejs/worker
```

```sh [yarn]
yarn add @rytejs/worker
```

:::

`@rytejs/worker` has a peer dependency on `@rytejs/core`.

## Creating a Worker

Pass your routers and adapters to `createWorker()`:

<<< @/snippets/guide/worker.ts#create-worker

| Option | Default | Description |
| --- | --- | --- |
| `routers` | _(required)_ | Array of `WorkflowRouter` instances |
| `store` | _(required)_ | `StoreAdapter` for persisting snapshots |
| `queue` | _(required)_ | `QueueAdapter` for message processing |
| `lock` | In-memory (30s TTL) | `LockAdapter` for preventing concurrent execution |
| `concurrency` | `1` | Max commands processed in parallel |
| `pollInterval` | `1000` | Milliseconds between queue polls |
| `retryPolicy` | See [Retry Policies](#retry-policies) | Per-category error handling |
| `shutdownTimeout` | `30000` | Max milliseconds to wait for in-flight commands on stop |

The worker creates an internal `ExecutionEngine` from the provided adapters. You can use `memoryAdapter()` for testing or pass production adapters (e.g., PostgreSQL-backed store and queue).

## Sending Commands

Enqueue a command for background processing with `worker.send()`:

<<< @/snippets/guide/worker.ts#send

The command is added to the queue and processed on the next poll cycle. Unlike `engine.execute()`, `send()` returns immediately without waiting for the command to complete.

## Start and Stop

<<< @/snippets/guide/worker.ts#lifecycle

`start()` begins polling the queue. `stop()` stops polling and waits for any in-flight commands to finish, up to `shutdownTimeout` milliseconds. If in-flight commands don't complete in time, `stop()` resolves anyway.

## Retry Policies

Each error category has an independent policy: `retry`, `dead-letter`, or `drop`.

<<< @/snippets/guide/worker.ts#retry-policy

### Default Policy

| Category | Default action | Rationale |
| --- | --- | --- |
| `dependency` | `retry` (3 attempts, exponential backoff) | Transient failures (network, database) are likely to recover |
| `unexpected` | `dead-letter` | Unknown errors need investigation |
| `domain` | `dead-letter` | Business rule violations need manual resolution |
| `validation` | `drop` | Invalid payloads will never succeed |
| `router` | `drop` | No handler exists for this command in the current state |

### Category Actions

| Action | Behavior |
| --- | --- |
| `retry` | Re-queue with backoff delay. After `maxRetries`, falls through to dead-letter. |
| `dead-letter` | Move the message to the dead-letter store for manual inspection. |
| `drop` | Acknowledge and discard the message. |

## Backoff Strategies

When using `action: "retry"`, the `backoff` option controls the delay between attempts.

### Shorthand Strings

Pass a string for common defaults:

| Shorthand | Resolved config |
| --- | --- |
| `"exponential"` | `{ strategy: "exponential", base: 1000, max: 30000 }` |
| `"fixed"` | `{ strategy: "fixed", delay: 1000 }` |
| `"linear"` | `{ strategy: "linear", delay: 1000, max: 30000 }` |

### Full Configuration

For fine-grained control, pass a `BackoffConfig` object:

<<< @/snippets/guide/worker.ts#backoff

| Strategy | Delay formula | Fields |
| --- | --- | --- |
| `exponential` | `min(base * 2^attempt, max)` | `base`, `max` |
| `fixed` | `delay` (constant) | `delay` |
| `linear` | `min(delay * attempt, max)` | `delay`, `max` |

## Reactors

Reactors connect workflows by turning events from one workflow into commands for another (or the same) workflow.

<<< @/snippets/guide/worker.ts#reactors

The callback receives `{ event, workflowId }` and returns one of:

| Return value | Behavior |
| --- | --- |
| `ReactorCommand` | Enqueue a single command |
| `ReactorCommand[]` | Enqueue multiple commands |
| `null` | Skip — do nothing for this event |

### Skipping Events

Return `null` to conditionally skip an event:

<<< @/snippets/guide/worker.ts#reactor-null

## Lifecycle Hooks

Observe worker activity without affecting processing:

<<< @/snippets/guide/worker.ts#hooks

### Hook Events

| Event | When | Payload |
| --- | --- | --- |
| `worker:started` | After `start()` is called | `{}` |
| `worker:stopped` | After `stop()` completes | `{}` |
| `command:started` | Before a command is executed | `{ workflowId, message }` |
| `command:completed` | After successful execution | `{ workflowId, message, result }` |
| `command:failed` | After a command fails (before retry/dead-letter/drop) | `{ workflowId, message, error, action }` |
| `command:retried` | After re-queuing with backoff | `{ workflowId, message, attempt, maxRetries, delay }` |
| `command:dead-lettered` | After moving to dead-letter store | `{ workflowId, message, error, reason }` |
| `command:dropped` | After acknowledging and discarding | `{ workflowId, message, error }` |

Hook errors are caught and isolated — they never affect command processing.

## Worker Plugins

Package reusable hook logic with `defineWorkerPlugin()`:

<<< @/snippets/guide/worker.ts#plugin

Plugins receive a `WorkerHookRegistry` with the `on()` method. This is the same interface exposed by `worker.on()`, packaged for reuse across worker instances.
