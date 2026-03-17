# Migrations

Workflows evolve over time. When you change state schemas, old snapshots stored in your database no longer match the new shape. Migrations let you transform those snapshots through a versioned pipeline so they can be safely restored.

The `modelVersion` field on every snapshot is the anchor — it records which version of your schema produced the data. When you bump `modelVersion` on the definition, old snapshots carry a lower number and need to be migrated before `restore()` will accept them.

## Defining a Migration Pipeline

`defineMigrations()` takes a definition and a map of version-keyed transform functions:

<<< @/snippets/guide/migrations.ts#define-pipeline

Each key is either a plain transform function or an object with a `description` and an `up` function:

<<< @/snippets/guide/migrations.ts#define-with-description

The `description` is optional but shows up in `onStep` callbacks (see [Observability Callbacks](#observability-callbacks)).

Each key is the **target version** — the function transforms from `(key - 1)` to `key`. Migration functions operate on `unknown` data, so `as any` casts are expected here. Type safety is restored at the `restore()` boundary, not inside the migration functions themselves.

The pipeline auto-stamps `modelVersion` after each step, even if your function sets it. You only transform data and, optionally, state.

`defineMigrations()` validates the map at creation time and throws if:

- Any key is `<= 1` (version 1 is the baseline — no migration needed)
- There are gaps in the version sequence (e.g., keys 2 and 4 but not 3)
- The highest key doesn't match the definition's `modelVersion`

If the definition has `modelVersion: 1` (or unset) and the map is empty, a valid pipeline is returned with nothing to run.

## Running Migrations

`migrate()` runs the pipeline from the snapshot's current version to the target:

<<< @/snippets/guide/migrations.ts#migrate

`migrate()` is synchronous. Migration functions are pure data transforms — no async needed.

`migrate()` validates before running and returns an error (without throwing) if:

- `snapshot.definitionName` doesn't match the pipeline's definition name
- `snapshot.modelVersion` is not a positive integer
- The snapshot is already at a higher version than the target (can't downgrade)

If the snapshot is already at the target version, it is returned as-is.

## The Full Pattern: migrate() then restore()

`migrate()` and `restore()` are separate calls. Run migration first to bring the snapshot up to the current schema version, then restore to validate and reconstruct the typed workflow:

<<< @/snippets/guide/migrations.ts#full-pattern

## Observability Callbacks

`migrate()` accepts an optional third argument with lifecycle callbacks:

<<< @/snippets/guide/migrations.ts#observability

`onStep` fires after each successful step and receives the post-migration snapshot. `onError` fires when a step fails, before the error result is returned.

## Error Handling

When a migration step throws, `migrate()` catches it and returns a `MigrationError`:

<<< @/snippets/guide/migrations.ts#error-handling

`MigrationError` extends `Error` and is exported from `@rytejs/core`.

## Testing Migrations

`@rytejs/testing` provides three utilities for migration testing. All are synchronous and framework-agnostic.

### testMigration — single step

Verifies one migration function in isolation. Constructs a snapshot at version `from`, runs the migration to `from + 1`, and asserts the output data deep-equals `expected`:

<<< @/snippets/guide/migrations.ts#test-migration

Pass `state` to control which state name appears in the test snapshot. Defaults to the first state in the definition.

### testMigrationPath — full chain

Runs the entire pipeline from `from` to the target version and asserts the final version and data:

<<< @/snippets/guide/migrations.ts#test-path

### testMigrationRestore — migrate + restore round-trip

Runs `migrate()` then `definition.restore()` and asserts the restore succeeds. Use this to catch cases where migration produces data that satisfies the pipeline but fails schema validation:

<<< @/snippets/guide/migrations.ts#test-restore

`expectState` is optional. The definition is derived from the pipeline.
