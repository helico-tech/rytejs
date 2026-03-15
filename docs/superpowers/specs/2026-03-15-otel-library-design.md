# @rytejs/otel — OpenTelemetry Plugin Design

## Overview

`@rytejs/otel` is a single-package OpenTelemetry instrumentation plugin for `@rytejs/core`. It provides full observability — tracing, metrics, and structured logging — through a zero-config `definePlugin`-based API. Users register the plugin with `router.use(createOtelPlugin())` and get automatic instrumentation of all dispatch lifecycle events.

The plugin depends only on the OTEL API layer (`@opentelemetry/api`, `@opentelemetry/api-logs`). Users own their SDK setup — providers, exporters, and sampling. When no SDK is registered, all calls no-op silently per OTEL convention.

## Package Structure

```
packages/otel/                  # @rytejs/otel
  src/
    plugin.ts                   # createOtelPlugin() — registers all hooks
    tracing.ts                  # span lifecycle (start/end/attributes)
    metrics.ts                  # counters and histograms
    logging.ts                  # structured OTEL logs
    conventions.ts              # attribute names, span names, metric names
    index.ts                    # public exports
    __tests__/
      plugin.test.ts
      tracing.test.ts
      metrics.test.ts
      logging.test.ts
  package.json
  tsconfig.json
  tsup.config.ts
```

### Dependencies

- **Peer:** `@rytejs/core`, `@opentelemetry/api` `^1.0.0`, `@opentelemetry/api-logs` `^0.200.0`
- **Dev:** `vitest`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-logs` (for testing only)

### Exports

```ts
export { createOtelPlugin } from "./plugin.js";
```

One export. Internal modules (`tracing.ts`, `metrics.ts`, `logging.ts`, `conventions.ts`) are not exported.

## Public API

### Zero-config usage

```ts
import { createOtelPlugin } from "@rytejs/otel";

const otel = createOtelPlugin();
router.use(otel);
```

Uses global OTEL API to get `trace.getTracer("ryte")`, `metrics.getMeter("ryte")`, `logs.getLogger("ryte")`.

### Custom providers

```ts
createOtelPlugin({
  tracer: myTracer,     // optional — override tracer instance
  meter: myMeter,       // optional — override meter instance
  logger: myLogger,     // optional — override logger instance
})
```

For users with multiple tracers/meters who want ryte to use a specific one.

### No SDK behavior

When no OTEL SDK is registered, all tracer/meter/logger calls are no-ops. No warnings, no errors, zero overhead. This is the standard OTEL library convention.

## Tracing

### Span lifecycle

| Hook | Action |
|---|---|
| `dispatch:start` | Create span, store in context key + span map, set initial attributes |
| `transition` | Add span event `ryte.transition` (span retrieved from span map) |
| `event` | Add span event `ryte.event` (span retrieved from span map) |
| `error` | Add error attributes to span (span retrieved from context key) |
| `dispatch:end` | Set span status, end span, remove from span map |

### Span naming

`ryte.dispatch.{CommandType}` — e.g., `ryte.dispatch.PlaceOrder`

### Span attributes (set at start)

| Attribute | Source | Example |
|---|---|---|
| `ryte.workflow.id` | `workflow.id` | `"ord_123"` |
| `ryte.workflow.state` | `workflow.state` | `"Draft"` |
| `ryte.workflow.definition` | `workflow.definitionName` | `"order"` |
| `ryte.command.type` | `command.type` | `"PlaceOrder"` |

### Transition span event — `ryte.transition`

| Attribute | Source |
|---|---|
| `ryte.transition.from` | `from` |
| `ryte.transition.to` | `to` |

### Domain event span event — `ryte.event`

| Attribute | Source |
|---|---|
| `ryte.event.type` | `event.type` |

### Error attributes (added on `error` hook)

| Attribute | Source | When |
|---|---|---|
| `ryte.error.category` | `error.category` | Always |
| `ryte.error.code` | `error.code` | domain, router |
| `ryte.error.source` | `error.source` | validation |
| `ryte.error.dependency` | `error.name` | dependency |
| `ryte.error.message` | `error.message` | validation, router, unexpected, dependency (not domain) |

Note: `domain` errors have no `message` field — they carry `code` and `data` only. The `ryte.error.message` attribute is omitted for domain errors. For domain errors, `ryte.error.code` serves as the primary identifier.

### Span completion (dispatch:end)

- Status: `SpanStatusCode.OK` if `result.ok`, `SpanStatusCode.ERROR` otherwise
- If error: `otel.status_description` set to `error.message` when available, or `error.code` for domain errors
- `span.end()` called
- Span removed from the span map (cleanup)

### Context propagation

**Dual storage strategy** — needed because not all hooks receive `ReadonlyContext`:

- **Context key:** `createKey<Span>("ryte.otel.span")` — used by `dispatch:start`, `error`, and `dispatch:end` hooks, which receive `ReadonlyContext` and can call `ctx.get(spanKey)` / `ctx.set(spanKey, span)`.
- **Span map:** `Map<string, Span>` keyed on `workflow.id` — used by `transition` and `event` hooks, which receive `(from, to, workflow)` and `(event, workflow)` respectively (no `ReadonlyContext`). The map is scoped to the plugin closure.
- **Start time:** `createKey<number>("ryte.otel.startTime")` — stored via context key, only read in `dispatch:end`.

The span map is set in `dispatch:start` and cleaned up in `dispatch:end` (which is guaranteed to fire). For concurrent dispatches on the same workflow ID, the map entry is overwritten — this is acceptable because concurrent dispatches on the same workflow instance are not a supported pattern in @rytejs (the workflow is passed by value, and concurrent mutation would produce undefined results regardless).

## Metrics

Three instruments from a single `Meter` named `ryte`:

### Counter: `ryte.dispatch.count`

Incremented on every `dispatch:end`.

| Attribute | Value |
|---|---|
| `ryte.command.type` | `"PlaceOrder"` |
| `ryte.workflow.state` | state at dispatch start |
| `ryte.result` | `"ok"` or `"error"` |
| `ryte.error.category` | category if error, omitted if ok |

### Histogram: `ryte.dispatch.duration`

Records millisecond duration on every `dispatch:end`. Uses start time from context key.

| Attribute | Value |
|---|---|
| `ryte.command.type` | `"PlaceOrder"` |
| `ryte.workflow.state` | state at dispatch start |
| `ryte.result` | `"ok"` or `"error"` |

### Counter: `ryte.transition.count`

Incremented on every `transition` hook.

| Attribute | Value |
|---|---|
| `ryte.transition.from` | `"Draft"` |
| `ryte.transition.to` | `"Placed"` |

## Logging

Logger named `ryte`. Emits structured OTEL log records at two points.

### On `dispatch:end` — always

Severity: `INFO` if `result.ok`, `WARN` if error.

Body: `"dispatch {CommandType} → {ok|error}"`

| Attribute | Value |
|---|---|
| `ryte.command.type` | `"PlaceOrder"` |
| `ryte.workflow.id` | `"ord_123"` |
| `ryte.workflow.state` | state at dispatch start |
| `ryte.result` | `"ok"` or `"error"` |
| `ryte.error.category` | category if error |
| `ryte.error.code` | code if domain/router error |
| `ryte.dispatch.duration_ms` | milliseconds |

### On `error` hook — error details

Severity: `WARN` for domain/validation/router, `ERROR` for unexpected/dependency.

Body: `"error {category}: {message}"` (for domain errors: `"error domain: {code}"`)

| Attribute | Value |
|---|---|
| `ryte.error.category` | `"domain"` |
| `ryte.error.code` | code if applicable |
| `ryte.error.source` | source if validation |
| `ryte.error.dependency` | dep name if dependency |

### Trace correlation

OTEL logs automatically attach to the active span context. No extra work needed.

### What's not logged

Transitions and domain events are captured as span events in tracing. They are not duplicated as logs to avoid noise.

## Plugin Internals

`createOtelPlugin()` returns a `definePlugin(...)` that:

1. Creates context keys for span and start time
2. Creates a `Map<string, Span>` for span lookup from hooks without `ReadonlyContext`
3. Acquires tracer/meter/logger (from options or global OTEL API)
4. Creates metric instruments (counters, histogram)
5. Registers all 5 hooks:
   - `dispatch:start` (receives `ReadonlyContext`) — create span, store in context key + span map, store start time, set initial attributes
   - `transition` (receives `from, to, workflow`) — look up span from span map via `workflow.id`, add span event, increment transition counter
   - `event` (receives `event, workflow`) — look up span from span map via `workflow.id`, add span event
   - `error` (receives `error, ReadonlyContext`) — retrieve span from context key, add error attributes, emit error log
   - `dispatch:end` (receives `ReadonlyContext, result`) — retrieve span from context key, set span status, record duration, increment dispatch counter, emit dispatch log, end span, remove from span map

The plugin is generic over `WorkflowConfig` and `TDeps`, matching the `definePlugin` signature. The `transition` and `event` hooks do not receive `ReadonlyContext` — they access the span via the plugin-scoped `Map<string, Span>` keyed on `workflow.id`.

## Testing Strategy

### Test setup

Each test file creates an in-memory OTEL SDK using the official `@opentelemetry/sdk-*` dev dependencies. After each test, read recorded spans/metrics/logs from in-memory exporters.

### Tracing tests (`tracing.test.ts`)

- Successful dispatch creates span with correct name, attributes, OK status
- Failed dispatch (each of 5 error categories) creates span with ERROR status and correct error attributes
- Transition adds span event with from/to
- Domain event adds span event with event type
- Span ends even when handler throws (dispatch:end guarantee)

### Metrics tests (`metrics.test.ts`)

- Dispatch increments `ryte.dispatch.count` with correct attributes
- Dispatch records `ryte.dispatch.duration` histogram (value > 0)
- Transition increments `ryte.transition.count` with from/to
- Error dispatches tag counter with error category

### Logging tests (`logging.test.ts`)

- Successful dispatch emits INFO log
- Error dispatch emits WARN log with error details
- Unexpected/dependency errors emit ERROR severity
- Log attributes match span attributes for correlation

### Plugin integration tests (`plugin.test.ts`)

- `createOtelPlugin()` with no config works (uses global OTEL API)
- Custom tracer/meter/logger overrides are used when provided
- Plugin registers on all 5 hook events
- Multiple dispatches create independent spans
- No-op behavior when no SDK is registered (no errors, no output)

### Test utilities

Use `@rytejs/testing`'s `createTestWorkflow`, `expectOk`, `expectError` for workflow setup and assertions.

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Tracing + metrics + logs | Full observability stack |
| Package count | Single `@rytejs/otel` | Pre-1.0, minimize maintenance burden |
| OTEL dependency | Peer dep on API packages | Users own their SDK setup |
| SDK setup | User's responsibility | OTEL convention — libraries instrument, apps configure |
| Integration | `definePlugin`-based | Idiomatic @rytejs pattern |
| Config | Zero-config default, optional overrides | Opinionated defaults |
| No SDK behavior | Silent no-ops | OTEL convention |
| Plugin structure | Single composite | Unused signals no-op anyway |
| Naming | `ryte.*` namespace | No OTEL semantic convention for workflow engines |
