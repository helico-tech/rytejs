# Ryte Roadmap Design

## Overview

A phased roadmap for `@rytejs/core` and its companion packages, focused on three priorities:

1. **DX excellence** — make the developer experience so delightful that people choose Ryte purely because it's a joy to use
2. **Production readiness** — stability, testability, and tooling that lets teams ship with confidence
3. **Completeness (conservative)** — round out real-world capabilities without baking in opinions; keep the core agnostic

Every release ships something developers can feel AND something that strengthens the core.

## Target Audience

- **Primary:** Backend/API developers building business logic (order flows, approval chains, content pipelines)
- **Secondary:** Full-stack developers who want a state machine that works across server and client

## Design Principles

- **Agnostic core** — Ryte defines protocols and extension points, never imports infrastructure libraries
- **Plain data out** — introspection, serialization, and visualization all produce plain objects or strings, not framework-coupled abstractions
- **`.use()` for everything** — plugins, composable routers, and future extension mechanisms all go through a single verb on the router
- **Hooks observe, middleware intercepts** — lifecycle hooks are read-only observers; middleware controls the dispatch pipeline
- **Companion packages are optional** — the core is complete on its own; companion packages reduce boilerplate and add DX sugar

---

## Phase 1: Introspect & Extend (v0.2)

### 1.1 Introspection API (core)

Expose the static shape of a workflow definition and the dynamic transition graph of a router programmatically.

Two complementary `inspect()` methods at different levels:

**Definition-level introspection** — returns the static shape (what states, commands, events, and errors exist). This is a new method on the `WorkflowDefinition` object returned by `defineWorkflow()`, derived from the config's schema keys.

```ts
const info = orderWorkflow.inspect();

info.states      // ['Draft', 'Placed', 'Shipped', 'Delivered', 'Cancelled']
info.commands    // ['PlaceOrder', 'ShipOrder', 'CancelOrder', ...]
info.events      // ['OrderPlaced', 'OrderShipped', ...]
info.errors      // ['OutOfStock', 'PaymentFailed', ...]
```

**Router-level introspection** — returns the dynamic transition map (which commands are handled in which states, and what transitions are possible). This lives on `WorkflowRouter` because only the router knows actual handler registrations and their declared targets.

```ts
const graph = router.inspect();

graph.transitions
// [
//   { from: 'Draft', command: 'PlaceOrder', to: ['Placed', 'Cancelled'] },
//   { from: 'Placed', command: 'ShipOrder', to: ['Shipped'] },
//   ...
// ]
```

- Both return plain objects — no methods, no classes
- Foundation for visualization, devtools, and testing packages

### 1.2 Lifecycle Hooks / Plugin System (core)

Extension points for events outside the dispatch pipeline.

**Hook points and signatures:**

**`ReadonlyContext`** — a subset of `Context` that exposes read-only properties and context-key access, but no dispatch mutation methods:
- **Included:** `command`, `workflow`, `deps`, `data`, `events`, `get()`, `getOrNull()`, `set()` (context-key storage is metadata, not dispatch mutation)
- **Excluded:** `update()`, `transition()`, `emit()`, `error()`

```ts
router.on('dispatch:start', (ctx: ReadonlyContext) => void)

// result is the same DispatchResult the caller receives
router.on('dispatch:end', (ctx: ReadonlyContext, result: DispatchResult) => void)

// from/to are state name strings; workflow is the post-transition snapshot
router.on('transition', (from: StateNames, to: StateNames, workflow: Workflow) => void)

// error is the PipelineError from the dispatch result
router.on('error', (error: PipelineError, ctx: ReadonlyContext) => void)

// event contains { name, data }; workflow is the post-dispatch snapshot
router.on('event', (event: { name: EventNames; data: EventData }, workflow: Workflow) => void)
```

**Hook execution and error policy:**
- Hooks registered for the same event run in `.use()` / `.on()` registration order
- Hook errors are caught and forwarded to a configurable `onHookError` callback on the router (defaults to `console.error`). They never affect the dispatch result. The `onHookError` callback is provided via an options object on the `WorkflowRouter` constructor: `new WorkflowRouter(definition, deps, { onHookError: (err) => { ... } })`.
- Hooks cannot unregister themselves (simplicity over flexibility; revisit if needed)

**How hooks differ from middleware:**

| Aspect | Middleware | Hooks |
|--------|-----------|-------|
| Role | In the pipeline — can modify, short-circuit, wrap | Observer — reacts to things that happened |
| Failure | Errors propagate and affect dispatch | Caught, forwarded to `onHookError`, never affect dispatch |
| Context | Full `Context` (can update, transition, emit) | `ReadonlyContext` (read-only, no mutation methods) |
| Use case | Auth, validation, logging around dispatch | Telemetry, devtools, audit trails |

**Plugin system:**

A plugin is a plain function that receives the router and registers hooks and/or middleware:

```ts
type Plugin<TConfig, TDeps> = (router: WorkflowRouter<TConfig, TDeps>) => void;

const loggingPlugin: Plugin<MyConfig, MyDeps> = (router) => {
  router.on('dispatch:start', (ctx) => console.log(`→ ${ctx.command}`));
  router.on('transition', (from, to) => console.log(`${from} → ${to}`));
};

router.use(loggingPlugin);
```

- `.use()` accepts composable routers (`WorkflowRouter` instances), plugins, and middleware — discriminated as follows:
  - `WorkflowRouter` instance → composable router (merge handlers)
  - Function with `(router) => void` signature → plugin (receives router, registers hooks/middleware)
  - Function with `(ctx, next) => Promise<void>` signature → global middleware
  - Discrimination uses a branded symbol on plugins (e.g., `Symbol.for('ryte:plugin')`) rather than arity checks, since arity is fragile with default params and destructuring. A `definePlugin()` helper brands the function.
- No class hierarchy, no registration ceremony
- The core ships hook infrastructure; actual plugins live in companion packages or userland

### 1.3 `@rytejs/viz` — Visualization (companion package)

Generates state diagram source code from the introspection API.

```ts
import { toMermaid, toD2 } from '@rytejs/viz';

const graph = router.inspect();

toMermaid(graph);
// stateDiagram-v2
//   Draft --> Placed : PlaceOrder
//   Placed --> Shipped : ShipOrder
//   ...

toD2(graph);
// Draft -> Placed: PlaceOrder
// Placed -> Shipped: ShipOrder
// ...
```

- **Output is source code (strings)** — developers paste into docs, pipe to CLI tools, or feed into devtools
- **Mermaid first, D2 second** — Mermaid has broader adoption (GitHub renders it natively in markdown)
- **Customization via options** — state grouping, highlighting terminal states, hiding/showing event and error annotations
- **Built entirely on the introspection API** — no coupling to router internals
- **Zero rendering dependencies** — tiny package footprint

---

## Phase 2: Test & Serialize (v0.3)

### 2.1 `@rytejs/testing` — Test Utilities (companion package)

Reduces workflow testing boilerplate. Framework-agnostic.

**Workflow factories:**

```ts
import { createTestWorkflow } from '@rytejs/testing';

const workflow = createTestWorkflow(orderDefinition, 'Placed', {
  orderId: '123',
  items: [{ sku: 'ABC', qty: 1 }],
});
```

**Dispatch result assertions:**

```ts
import { expectOk, expectError } from '@rytejs/testing';

const result = await router.dispatch(workflow, 'ShipOrder', payload);

expectOk(result);                            // asserts ok, narrows type
expectOk(result, 'Shipped');                 // asserts ok + specific state
expectError(result, 'domain', 'OutOfStock'); // asserts domain error with code
```

**Transition path testing:**

```ts
import { testPath } from '@rytejs/testing';

await testPath(router, orderDefinition, [
  { start: 'Draft', command: 'PlaceOrder', payload: {...}, expect: 'Placed' },
  { command: 'ShipOrder', payload: {...}, expect: 'Shipped' },
  { command: 'ConfirmDelivery', payload: {...}, expect: 'Delivered' },
]);
```

**Dependency stubs:**

```ts
import { createTestDeps } from '@rytejs/testing';

const deps = createTestDeps<MyDeps>({
  paymentService: { charge: vi.fn().mockResolvedValue({ success: true }) },
});
```

- Throws on failure — works with any test runner (Vitest, Jest, Node test runner)
- Built entirely on the public API of `@rytejs/core` (declared as a peer dependency)
- `createTestDeps<T>(partial)` returns the partial cast to the full type `T` — it does not proxy or throw on un-stubbed access. Developers provide only the dependencies their test needs.
- `testPath` creates the initial workflow from the first step's `start` state and `payload`, then chains dispatch results through subsequent steps. Initial state data can be provided via an optional `data` field on the first step.
- Focused on reducing boilerplate, not replacing your test framework

### 2.2 Serialization / Rehydration Protocol (core)

Agnostic foundation for persisting and restoring workflow state. Defines *what* a snapshot looks like, not *where* it goes.

```ts
const snapshot = definition.snapshot(workflow);
// {
//   state: 'Placed',
//   data: { orderId: '123', items: [...] },
//   createdAt: '2026-03-14T10:00:00.000Z',
//   updatedAt: '2026-03-14T10:05:00.000Z',
//   version: 1,
// }

const result = definition.restore(snapshot);
// { ok: true, workflow } | { ok: false, error }
```

- **`snapshot()` produces a plain, JSON-safe object** — no classes, no symbols, no circular refs
- **`restore()` validates through Zod schemas** — schema evolution is handled naturally; if the shape changed, you get a typed validation error
- **`version` field** — a schema version declared on the workflow definition (e.g., `defineWorkflow({ version: 1, ... })`), stamped onto every snapshot. This is a schema version, not a per-snapshot sequence number. When the workflow's state schemas change, the developer bumps the version. Userland migration code can check the version before calling `restore()` and transform the snapshot accordingly.
- **Date serialization** — `createdAt` and `updatedAt` are serialized as ISO 8601 strings in the snapshot. `restore()` reconstructs `Date` objects from these strings.
- **`restore()` error type** — returns `{ ok: false, error: ValidationError }` using the existing `ValidationError` class with `source: 'restore'`. This requires extending the `ValidationError.source` type union (currently `"command" | "state" | "event" | "transition"`) to include `"restore"`. Note: `restore()` errors are standalone `ValidationError` instances, not wrapped in `PipelineError` — they exist outside the dispatch pipeline.
- **Lives on `WorkflowDefinition`** — the definition owns the schemas, so it's the natural home. Both `snapshot()` and `restore()` are methods on the definition object returned by `defineWorkflow()`.
- **Persistence is userland** — storing and retrieving snapshots is trivial (`JSON.stringify` + any storage); no `@rytejs/persist-*` packages needed

### 2.3 Composable Routers (core)

Already designed in `2026-03-14-composable-routers-design.md`. Ships as specified.

Enables modular handler organization via `router.use(childRouter)`. Pairs with the plugin system — `.use()` accepts both routers and plugins, discriminated by type.

---

## Phase 3: See & Observe (v0.4)

### 3.1 `@rytejs/devtools` — Web-Based Workflow Inspector (companion package)

The convergence point for introspection, hooks, serialization, and visualization.

**Features:**

- **Live state diagram** — rendered from introspection API, highlights current state, animates transitions as they happen
- **Event timeline** — chronological feed of dispatches, transitions, events, and errors with expandable detail
- **Workflow explorer** — browse active workflow instances, inspect current state and data
- **Dispatch sandbox** — manually dispatch commands against a workflow to test behavior interactively (stretch goal)

**Architecture:**

```
Your app                    @rytejs/devtools
┌─────────────┐            ┌──────────────────┐
│ Router +    │  WebSocket  │  Local dev server │
│ devtools    │────────────▶│  (Vite + UI)     │
│ plugin      │            └──────────────────┘
└─────────────┘
```

- **Devtools plugin** — installed via `router.use(devtoolsPlugin())`, uses lifecycle hooks to stream events over WebSocket
- **Dev server** — separate process (`npx @rytejs/devtools`), renders the UI
- **Zero production footprint** — plugin is a no-op outside dev mode, gated by explicit opt-in (e.g., `devtoolsPlugin({ enabled: true })`). May check `NODE_ENV` as a convenience fallback in the companion package, but never in core. This avoids coupling to Node.js conventions in edge runtimes.
- **Built entirely on public APIs** — introspection for diagrams, hooks for event stream, serialization for workflow snapshots

**Shipping strategy:** v0.4-alpha ships with state diagram + event timeline. Dispatch sandbox follows in a subsequent release.

### 3.2 Observability Recipes (documentation)

Not a package — documented patterns showing how to use the plugin/hooks system with popular observability stacks.

**Example: OpenTelemetry tracing:**

```ts
const otelPlugin = (router) => {
  router.on('dispatch:start', (ctx) => {
    const span = tracer.startSpan(`ryte.dispatch.${ctx.command}`);
    ctx.set(spanKey, span);
  });
  router.on('dispatch:end', (ctx, result) => {
    ctx.get(spanKey).end();
  });
};
```

- The core provides the hooks; userland decides the observability stack
- Ryte never imports a tracing library
- If community demand warrants it, a `@rytejs/otel` package could be extracted later

---

## Package Overview

| Package | Type | Phase | Description |
|---------|------|-------|-------------|
| `@rytejs/core` | Core | v0.2–0.3 | Introspection, hooks/plugins, serialization, composable routers |
| `@rytejs/viz` | Companion | v0.2 | Mermaid/D2 diagram generation |
| `@rytejs/testing` | Companion | v0.3 | Test factories, assertions, path testing |
| `@rytejs/devtools` | Companion | v0.4 | Web-based workflow inspector |

## Prerequisites

These must be resolved before Phase 1 implementation begins:

- **Transition declaration mechanism** — Handlers call `ctx.transition()` dynamically, so the introspection API cannot infer possible transitions from code. A declarative approach is needed. Likely solution: a `targets` declaration on handler registration (e.g., `state.handle('PlaceOrder', { targets: ['Placed', 'Cancelled'] }, handler)`). This is a prerequisite design spike — it affects the handler registration API and must be resolved before introspection, visualization, or devtools can be implemented.

## Open Questions

- **Devtools transport:** WebSocket only for v0.4. Polling/SSE can be added in a future version if cloud-hosted devtools creates demand.
- **Visualization customization API:** Start minimal (default styles, terminal state highlighting). Expand based on feedback.
- **Hook execution ordering:** Currently specified as registration order. If composition via plugins creates ordering conflicts, consider a priority system — but defer until the need arises.
