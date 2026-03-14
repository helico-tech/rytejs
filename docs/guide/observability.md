# Observability

These are copy-pasteable patterns for adding observability to your workflows. They use the hooks and plugin system described in the [Hooks & Plugins](/guide/hooks-and-plugins) guide — no additional packages required.

## Structured Logging

Captures command type, final state, success/failure, and duration on every dispatch.

```ts
import { createKey, definePlugin } from "@rytejs/core";

const startTimeKey = createKey<number>("startTime");

const loggingPlugin = definePlugin((router) => {
	router.on("dispatch:start", (ctx) => {
		ctx.set(startTimeKey, Date.now());
	});
	router.on("dispatch:end", (ctx, result) => {
		const duration = Date.now() - ctx.get(startTimeKey);
		console.log(JSON.stringify({
			command: ctx.command.type,
			state: ctx.workflow.state,
			ok: result.ok,
			duration,
		}));
	});
});
```

Because `dispatch:end` is guaranteed to fire whenever `dispatch:start` fires, the duration is always recorded — even when the handler throws an unexpected error.

## OpenTelemetry Tracing

Creates a span per dispatch, sets its status based on the result, and ends it after the dispatch completes.

```ts
import { createKey, definePlugin } from "@rytejs/core";
// import { tracer, SpanStatusCode } from "./your-otel-setup";

const spanKey = createKey<any>("span");

const otelPlugin = definePlugin((router) => {
	router.on("dispatch:start", (ctx) => {
		const span = tracer.startSpan(`ryte.dispatch.${ctx.command.type}`);
		ctx.set(spanKey, span);
	});
	router.on("dispatch:end", (ctx, result) => {
		const span = ctx.get(spanKey);
		span.setStatus({ code: result.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
		span.end();
	});
});
```

Replace the commented import with your actual OpenTelemetry tracer setup. The span name includes the command type, making traces easy to filter by command.

## Audit Trail

Records every state transition and every domain error to an external audit log.

```ts
import { definePlugin } from "@rytejs/core";

const auditPlugin = definePlugin((router) => {
	router.on("transition", (from, to, workflow) => {
		auditLog.record({
			workflowId: workflow.id,
			from,
			to,
			timestamp: new Date(),
		});
	});
	router.on("error", (error, ctx) => {
		auditLog.record({
			workflowId: ctx.workflow.id,
			error: error.category,
			command: ctx.command.type,
			timestamp: new Date(),
		});
	});
});
```

The `error` hook fires for domain and validation errors — the same errors returned in the result rather than thrown. Unexpected errors (handler throws) are not captured here; use `dispatch:end` with `result.ok === false` and `result.category === "unexpected"` if you need those.

## Metrics

Increments counters for every dispatch and every state transition, tagged with relevant dimensions.

```ts
import { definePlugin } from "@rytejs/core";

const metricsPlugin = definePlugin((router) => {
	router.on("dispatch:end", (ctx, result) => {
		metrics.increment("ryte.dispatch.total", {
			command: ctx.command.type,
			state: ctx.workflow.state,
			ok: String(result.ok),
		});
	});
	router.on("transition", (from, to) => {
		metrics.increment("ryte.transition.total", { from, to });
	});
});
```

Replace `metrics.increment` with whatever client your metrics backend provides (StatsD, Prometheus, Datadog, etc.). The tags give you per-command and per-state breakdown out of the box.

## Registering Plugins

All four plugins above are registered the same way:

```ts
import { WorkflowRouter } from "@rytejs/core";

const router = new WorkflowRouter(definition, deps);

router.use(loggingPlugin);
router.use(otelPlugin);
router.use(auditPlugin);
router.use(metricsPlugin);
```

See [Hooks & Plugins](/guide/hooks-and-plugins) for the full hook event reference and error isolation behaviour.
