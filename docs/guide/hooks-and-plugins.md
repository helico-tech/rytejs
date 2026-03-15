# Hooks & Plugins

Lifecycle hooks observe dispatch events without affecting the pipeline. Plugins package hooks and middleware into reusable units.

## Lifecycle Hooks

Register hooks with `router.on()`:

```ts
import { WorkflowRouter } from "@rytejs/core";

const router = new WorkflowRouter(definition);

router.on("dispatch:start", ({ command }) => {
	console.log(`→ ${command.type}`);
});

router.on("dispatch:end", (_ctx, result) => {
	console.log(`← ${result.ok ? "ok" : "error"}`);
});

router.on("transition", (from, to, workflow) => {
	console.log(`${from} → ${to}`);
});

router.on("error", (error, _ctx) => {
	console.log(`error: ${error.category}`);
});

router.on("event", (event, workflow) => {
	console.log(`event: ${event.type}`);
});
```

### Hook Events

| Event | When | Parameters |
|-------|------|------------|
| `dispatch:start` | After context created, before handler | `(ctx)` |
| `dispatch:end` | After dispatch completes (always) | `(ctx, result)` |
| `transition` | After a state change | `(from, to, workflow)` |
| `error` | On domain or validation error | `(error, ctx)` |
| `event` | For each emitted event | `(event, workflow)` |

### Hooks vs Middleware

| | Middleware | Hooks |
|---|-----------|-------|
| **Role** | In the pipeline — can modify, short-circuit | Observer — reacts after the fact |
| **Errors** | Propagate and affect dispatch | Caught, never affect dispatch |
| **Context** | Full `Context` | `ReadonlyContext` (no `update`, `transition`, `emit`, `error`) |
| **Use for** | Auth, validation, wrapping | Telemetry, logging, devtools |

Hooks receive a `ReadonlyContext` — it has `command`, `workflow`, `deps`, `data`, `events`, and context-key access (`set`/`get`/`getOrNull`), but no mutation methods.

### Error Isolation

Hook errors never affect the dispatch result. By default they are logged to `console.error`. You can provide a custom handler:

```ts
const router = new WorkflowRouter(definition, deps, {
	onHookError: (err) => myLogger.warn("Hook error:", err),
});
```

### Execution Order

Hooks run in registration order. Multiple hooks on the same event all fire, even if one throws.

`dispatch:end` is guaranteed to fire whenever `dispatch:start` fires, even if the handler throws an unexpected error.

## Plugins

A plugin is a function that receives the router and configures it — registering hooks, middleware, or both.

### Defining a Plugin

```ts
import { definePlugin } from "@rytejs/core";

const loggingPlugin = definePlugin((router) => {
	router.on("dispatch:start", ({ command }) => {
		console.log(`[${new Date().toISOString()}] → ${command.type}`);
	});
	router.on("dispatch:end", (_ctx, result) => {
		console.log(`[${new Date().toISOString()}] ← ${result.ok ? "ok" : "error"}`);
	});
});
```

### Using a Plugin

Pass it to `router.use()`:

```ts
const router = new WorkflowRouter(definition);
router.use(loggingPlugin);
```

### How `.use()` Discriminates

`router.use()` accepts three things:

| Argument | What happens |
|----------|-------------|
| `WorkflowRouter` instance | Merges handlers (composable routers) |
| `definePlugin()` result | Calls the plugin function with the router |
| Plain function `(ctx, next) => ...` | Adds as global middleware |

Plugins are branded with a symbol by `definePlugin()`, so the router can tell them apart from middleware at runtime.

### Plugin + Middleware

Plugins can register both hooks and middleware:

```ts
const authPlugin = definePlugin((router) => {
	// Middleware: runs in the dispatch pipeline
	router.use(async ({ deps }, next) => {
		if (!deps.currentUser) throw new Error("Unauthorized");
		await next();
	});

	// Hook: observes after the fact
	router.on("dispatch:end", ({ command }, result) => {
		auditLog.record(command, result);
	});
});
```
