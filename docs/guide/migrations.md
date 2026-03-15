# Migrations

Workflows evolve over time. When you change state schemas, old snapshots stored in your database no longer match the new shape. Migrations let you transform those snapshots through a versioned pipeline so they can be safely restored.

The `modelVersion` field on every snapshot is the anchor — it records which version of your schema produced the data. When you bump `modelVersion` on the definition, old snapshots carry a lower number and need to be migrated before `restore()` will accept them.

## Defining a Migration Pipeline

`defineMigrations()` takes a definition and a map of version-keyed transform functions:

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

Each key is either a plain transform function or an object with a `description` and an `up` function:

```ts
const migrations = defineMigrations(definition, {
	2: {
		description: "Add status field",
		up: (snap) => ({
			...snap,
			data: { ...(snap.data as Record<string, unknown>), status: "active" },
		}),
	},
});
```

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

```ts
import { migrate } from "@rytejs/core";

const result = migrate(migrations, oldSnapshot);

if (result.ok) {
	// result.snapshot is now at the target modelVersion
} else {
	// result.error is a MigrationError
	console.error(result.error.message);
}
```

`migrate()` is synchronous. Migration functions are pure data transforms — no async needed.

`migrate()` validates before running and returns an error (without throwing) if:

- `snapshot.definitionName` doesn't match the pipeline's definition name
- `snapshot.modelVersion` is not a positive integer
- The snapshot is already at a higher version than the target (can't downgrade)

If the snapshot is already at the target version, it is returned as-is.

## The Full Pattern: migrate() then restore()

`migrate()` and `restore()` are separate calls. Run migration first to bring the snapshot up to the current schema version, then restore to validate and reconstruct the typed workflow:

```ts
const raw = JSON.parse(await db.get(`workflow:${id}`));

const migrated = migrate(migrations, raw);
if (!migrated.ok) {
	console.error(migrated.error); // MigrationError: step details
	return;
}

const restored = definition.restore(migrated.snapshot);
if (!restored.ok) {
	console.error(restored.error); // ValidationError: schema mismatch
	return;
}

// restored.workflow is a fully typed Workflow<TConfig>
const workflow = restored.workflow;
```

## Observability Callbacks

`migrate()` accepts an optional third argument with lifecycle callbacks:

```ts
const result = migrate(migrations, oldSnapshot, {
	onStep: (fromVersion, toVersion, snapshot, description) => {
		console.log(`Migrated ${fromVersion} → ${toVersion}: ${description ?? "no description"}`);
	},
	onError: (error) => {
		logger.error("Migration step failed", {
			from: error.fromVersion,
			to: error.toVersion,
			cause: error.cause,
		});
	},
});
```

`onStep` fires after each successful step and receives the post-migration snapshot. `onError` fires when a step fails, before the error result is returned.

## Error Handling

When a migration step throws, `migrate()` catches it and returns a `MigrationError`:

```ts
import { MigrationError } from "@rytejs/core";

if (!result.ok) {
	const err = result.error; // MigrationError
	console.log(err.fromVersion); // version the step started from
	console.log(err.toVersion);   // version the step was trying to reach
	console.log(err.cause);       // the original thrown value
	console.log(err.message);     // "Migration 2 → 3 failed: ..."
}
```

`MigrationError` extends `Error` and is exported from `@rytejs/core`.

## Testing Migrations

`@rytejs/testing` provides three utilities for migration testing. All are synchronous and framework-agnostic.

### testMigration — single step

Verifies one migration function in isolation. Constructs a snapshot at version `from`, runs the migration to `from + 1`, and asserts the output data deep-equals `expected`:

```ts
import { testMigration } from "@rytejs/testing";

testMigration(migrations, {
	from: 1,
	input: { firstName: "Alice", lastName: "Smith" },
	expected: { firstName: "Alice", lastName: "Smith", status: "active" },
});
```

Pass `state` to control which state name appears in the test snapshot. Defaults to the first state in the definition.

### testMigrationPath — full chain

Runs the entire pipeline from `from` to the target version and asserts the final version and data:

```ts
import { testMigrationPath } from "@rytejs/testing";

testMigrationPath(migrations, {
	from: 1,
	input: { firstName: "Alice", lastName: "Smith" },
	expectVersion: 3,
	expected: { fullName: "Alice Smith", status: "active" },
});
```

### testMigrationRestore — migrate + restore round-trip

Runs `migrate()` then `definition.restore()` and asserts the restore succeeds. Use this to catch cases where migration produces data that satisfies the pipeline but fails schema validation:

```ts
import { testMigrationRestore } from "@rytejs/testing";

testMigrationRestore(migrations, {
	from: 1,
	input: { firstName: "Alice", lastName: "Smith" },
	expectState: "Draft",
});
```

`expectState` is optional. The definition is derived from the pipeline.
