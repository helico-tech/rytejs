# Observability

These are copy-pasteable patterns for adding observability to your workflows. They use the hooks and plugin system described in the [Hooks & Plugins](/guide/hooks-and-plugins) guide — no additional packages required.

## @rytejs/otel

For production OpenTelemetry instrumentation, use the official plugin:

```bash
pnpm add @rytejs/otel
```

One line to instrument a router with tracing and metrics:

<<< @/snippets/guide/observability-otel.ts#install

This automatically:
- Creates a span per dispatch (`ryte.dispatch.{commandType}`)
- Records transitions and events as span events
- Sets error status with category, code, and source attributes
- Emits three metrics: `ryte.dispatch.count`, `ryte.dispatch.duration`, `ryte.transition.count`

By default it uses the global OpenTelemetry API. To use a specific tracer or meter:

<<< @/snippets/guide/observability-otel.ts#custom

The patterns below are still useful if you want custom observability without the `@rytejs/otel` dependency.

## Executor Tracing

`createOtelExecutorPlugin` traces executor operations — `create()` and `execute()` calls — with span attributes for workflow ID, operation type, and command type:

<<< @/snippets/guide/observability-otel.ts#executor-plugin

Import from `@rytejs/otel` (the root export, no subpath).

### Full Stack Tracing

Combine the router plugin with the executor plugin for end-to-end traces. The executor span wraps the router dispatch span:

<<< @/snippets/guide/observability-otel.ts#full-stack-tracing

## Structured Logging

Captures command type, final state, success/failure, and duration on every dispatch.

<<< @/snippets/guide/observability.ts#logging

Because `pipeline:end` is guaranteed to fire whenever `pipeline:start` fires, the duration is always recorded — even when the handler throws an unexpected error.

## OpenTelemetry Tracing

Creates a span per dispatch, sets its status based on the result, and ends it after the dispatch completes.

<<< @/snippets/guide/observability.ts#otel

Replace the commented import with your actual OpenTelemetry tracer setup. The span name includes the command type, making traces easy to filter by command.

## Audit Trail

Records every state transition and every domain error to an external audit log.

<<< @/snippets/guide/observability.ts#audit

The `error` hook fires for domain and validation errors — the same errors returned in the result rather than thrown. Unexpected errors (handler throws a non-domain, non-validation error) are not captured here; use `pipeline:end` with `result.ok === false` and `result.error.category === "unexpected"` if you need those. Unexpected errors are captured as `{ category: "unexpected", error, message }` in the result, and `pipeline:end` always fires.

## Metrics

Increments counters for every dispatch and every state transition, tagged with relevant dimensions.

<<< @/snippets/guide/observability.ts#metrics

Replace `metrics.increment` with whatever client your metrics backend provides (StatsD, Prometheus, Datadog, etc.). The tags give you per-command and per-state breakdown out of the box.

## Registering Plugins

All four plugins above are registered the same way:

<<< @/snippets/guide/observability.ts#register

See [Hooks & Plugins](/guide/hooks-and-plugins) for the full hook event reference and error isolation behaviour.
