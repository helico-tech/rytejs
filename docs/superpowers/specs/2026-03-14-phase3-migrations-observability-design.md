# Phase 3: Migrations & Observability Design

## Overview

Phase 3 adds schema migration support to `@rytejs/core` and observability recipes to the documentation.

**Scope:**
1. Schema migrations — `defineMigrations()`, `migrate()`, `MigrationError`
2. Migration testing utilities — extend `@rytejs/testing`
3. Observability recipes — documentation only, no new packages

**Out of scope:** Devtools, performance, DX polish.

## Design Principles

- **Migrations are explicit** — `migrate()` is separate from `restore()`, developers call both
- **Migrations are untyped** — migration functions operate on `unknown` data; type safety is restored at the `restore()` boundary
- **Result pattern** — `migrate()` returns `{ ok, snapshot }` or `{ ok, error }`, consistent with `restore()`
- **Pipeline handles bookkeeping** — migration functions only transform data; `modelVersion` is auto-stamped after each step
- **Observability is userland** — the hooks/plugin system already supports it; we document patterns, not ship packages

---

## 1. Schema Migrations (core)

### 1.1 `defineMigrations(definition, migrationMap)`

Creates a migration pipeline from a definition and a map of version-keyed transform functions.

```ts
import { defineMigrations } from "@rytejs/core";

const migrations = defineMigrations(definition, {
  2: (snap) => ({
    ...snap,
    data: { ...(snap.data as any), status: "active" },
  }),
  3: (snap) => {
    const data = snap.data as any;
    return {
      ...snap,
      data: { ...data, fullName: `${data.firstName} ${data.lastName}` },
    };
  },
});
```

Each key is the **target version** — the function transforms from `(key - 1)` to `key`. The definition's `modelVersion` determines the final target.

**Return type:**

```ts
interface MigrationPipeline<TConfig extends WorkflowConfig> {
  readonly definition: WorkflowDefinition<TConfig>;
  readonly targetVersion: number;
  readonly migrations: ReadonlyMap<number, MigrationFn>;
}
```

**Validation at creation time:**
- Throws if any migration key is `<= 1` (version 1 is the baseline, no migration needed)
- Throws if there are gaps in the version sequence (e.g., map has 2 and 4 but not 3)
- Throws if the highest key doesn't match the definition's `modelVersion`

### 1.2 `migrate(pipeline, snapshot, options?)`

Runs the migration chain from the snapshot's `modelVersion` to the pipeline's `targetVersion`.

```ts
const result = migrate(migrations, oldSnapshot);
// { ok: true, snapshot: WorkflowSnapshot }
// { ok: false, error: MigrationError }
```

**Behavior:**
- Snapshot already at target version → returned as-is (`{ ok: true }`)
- Snapshot version higher than target → returns error (can't downgrade)
- Runs each migration step sequentially: v1 → v2 → v3
- After each step, auto-stamps `modelVersion` to the step's target version
- If a migration function throws, catches it and returns `{ ok: false, error: MigrationError }`

**Options:**

```ts
interface MigrateOptions {
  onStep?: (fromVersion: number, toVersion: number, snapshot: WorkflowSnapshot) => void;
  onError?: (error: MigrationError) => void;
}
```

Both callbacks are optional. `onStep` fires after each successful step (receives the post-migration snapshot). `onError` fires when a step fails (before the error result is returned).

### 1.3 `MigrationError`

```ts
class MigrationError extends Error {
  constructor(
    public readonly fromVersion: number,
    public readonly toVersion: number,
    public readonly cause: unknown,
  ) {
    super(
      `Migration ${fromVersion} → ${toVersion} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "MigrationError";
  }
}
```

Exported from `@rytejs/core`.

### 1.4 Types

```ts
/** A function that transforms a snapshot from one version to the next. */
type MigrationFn = (snapshot: WorkflowSnapshot) => WorkflowSnapshot;

/** Result of migrate(). */
type MigrateResult =
  | { ok: true; snapshot: WorkflowSnapshot }
  | { ok: false; error: MigrationError };
```

### 1.5 Full usage pattern

```ts
const migrated = migrate(migrations, oldSnapshot);
if (!migrated.ok) {
  console.error(migrated.error); // MigrationError: step details
  return;
}

const restored = definition.restore(migrated.snapshot);
if (!restored.ok) {
  console.error(restored.error); // ValidationError: schema mismatch
  return;
}

// restored.workflow is ready to use
```

---

## 2. Migration Testing (`@rytejs/testing`)

### 2.1 `testMigration()` — single step verification

```ts
import { testMigration } from "@rytejs/testing";

testMigration(migrations, {
  from: 1,
  input: { items: ["apple"] },
  expected: { items: ["apple"], newField: "default" },
});
```

Constructs a snapshot at version `from` with `input` as data, runs `migrate()` for one step (from → from+1), asserts the output data deep-equals `expected`. Throws with a clear message on mismatch or migration failure.

**Options:**

```ts
interface TestMigrationOptions {
  from: number;
  input: unknown;
  expected: unknown;
  /** Optional: state name for the test snapshot. Defaults to first state in definition. */
  state?: string;
}
```

### 2.2 `testMigrationPath()` — full chain verification

```ts
import { testMigrationPath } from "@rytejs/testing";

testMigrationPath(migrations, {
  from: 1,
  input: { oldField: "value" },
  expectVersion: 3,
  expected: { fullName: "value", status: "active" },
});
```

Runs the entire chain from `from` to the pipeline's target version. Asserts final `modelVersion` equals `expectVersion` and final data deep-equals `expected`.

### 2.3 `testMigrationRestore()` — migrate + restore round-trip

```ts
import { testMigrationRestore } from "@rytejs/testing";

testMigrationRestore(migrations, definition, {
  from: 1,
  input: { oldField: "value" },
  expectState: "Draft",
});
```

Runs the full pipeline: `migrate()` then `definition.restore()`. Asserts `restore()` succeeds and optionally checks the resulting state. Catches cases where migration produces data that passes the migration but fails schema validation.

---

## 3. Observability Recipes (documentation)

A guide page at `docs/guide/observability.md` with copy-pasteable plugin examples. No new packages.

### 3.1 Structured Logging

```ts
const loggingPlugin = definePlugin((router) => {
  router.on("dispatch:start", (ctx) => {
    const start = Date.now();
    ctx.set(startTimeKey, start);
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

### 3.2 OpenTelemetry Tracing

```ts
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

### 3.3 Audit Trail

```ts
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

### 3.4 Metrics

```ts
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

---

## Package Overview

| Change | Location | Type |
|--------|----------|------|
| `defineMigrations()`, `migrate()`, `MigrationError`, `MigrationFn`, `MigrateResult`, `MigrationPipeline` | `@rytejs/core` | New exports |
| `testMigration()`, `testMigrationPath()`, `testMigrationRestore()` | `@rytejs/testing` | New exports |
| Observability guide | `docs/guide/observability.md` | New documentation |
