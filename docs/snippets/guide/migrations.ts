import type { WorkflowSnapshot } from "@rytejs/core";
import { defineMigrations, defineWorkflow, MigrationError, migrate } from "@rytejs/core";
import { testMigration, testMigrationPath, testMigrationRestore } from "@rytejs/testing";
import { z } from "zod";

// ── Workflow definitions ─────────────────────────────────────────────────────

// modelVersion: 3 — used for all blocks except #define-with-description
const definition = defineWorkflow("user", {
	modelVersion: 3,
	states: {
		Draft: z.object({ fullName: z.string(), status: z.string() }),
	},
	commands: {
		Submit: z.object({}),
	},
	events: {},
	errors: {},
});

// modelVersion: 2 — used for #define-with-description only
const definitionV2 = defineWorkflow("user", {
	modelVersion: 2,
	states: {
		Draft: z.object({ firstName: z.string(), lastName: z.string(), status: z.string() }),
	},
	commands: {
		Submit: z.object({}),
	},
	events: {},
	errors: {},
});

// ── Stubs ────────────────────────────────────────────────────────────────────

declare const db: { get(key: string): Promise<string> };
declare const id: string;
declare const logger: { error(msg: string, data: unknown): void };
declare const oldSnapshot: WorkflowSnapshot;

// ── #define-pipeline ─────────────────────────────────────────────────────────

// #region define-pipeline
const migrations = defineMigrations(definition, {
	2: (snap) => ({
		...snap,
		// biome-ignore lint/suspicious/noExplicitAny: migration functions operate on unknown data
		data: { ...(snap.data as any), status: "active" },
	}),
	3: (snap) => {
		// biome-ignore lint/suspicious/noExplicitAny: migration functions operate on unknown data
		const data = snap.data as any;
		return {
			...snap,
			data: { ...data, fullName: `${data.firstName} ${data.lastName}` },
		};
	},
});
// #endregion define-pipeline

// ── #define-with-description ─────────────────────────────────────────────────

// #region define-with-description
const migrationsV2 = defineMigrations(definitionV2, {
	2: {
		description: "Add status field",
		up: (snap) => ({
			...snap,
			data: { ...(snap.data as Record<string, unknown>), status: "active" },
		}),
	},
});
// #endregion define-with-description

// ── #migrate ─────────────────────────────────────────────────────────────────

// #region migrate
const result = migrate(migrations, oldSnapshot);

if (result.ok) {
	// result.snapshot is now at the target modelVersion
} else {
	// result.error is a MigrationError
	console.error(result.error.message);
}
// #endregion migrate

// ── #full-pattern ─────────────────────────────────────────────────────────────

// #region full-pattern
async function loadWorkflow() {
	const raw = JSON.parse(await db.get(`workflow:${id}`));

	const migrated = migrate(migrations, raw);
	if (!migrated.ok) {
		console.error(migrated.error); // MigrationError: step details
		return;
	}

	const restored = definition.deserialize(migrated.snapshot);
	if (!restored.ok) {
		console.error(restored.error); // ValidationError: schema mismatch
		return;
	}

	// restored.workflow is a fully typed Workflow<TConfig>
	const workflow = restored.workflow;
	void workflow;
}
// #endregion full-pattern

// ── #observability ────────────────────────────────────────────────────────────

// #region observability
const observedResult = migrate(migrations, oldSnapshot, {
	onStep: (fromVersion, toVersion, _snapshot, description) => {
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
// #endregion observability

// ── #error-handling ───────────────────────────────────────────────────────────

// #region error-handling
const migrationResult = migrate(migrations, oldSnapshot);

if (!migrationResult.ok) {
	const err = migrationResult.error; // MigrationError
	console.log(err.fromVersion); // version the step started from
	console.log(err.toVersion); // version the step was trying to reach
	console.log(err.cause); // the original thrown value
	console.log(err.message); // "Migration 2 → 3 failed: ..."
}
// #endregion error-handling

// ── #test-migration ───────────────────────────────────────────────────────────

// #region test-migration
testMigration(migrations, {
	from: 1,
	input: { firstName: "Alice", lastName: "Smith" },
	expected: { firstName: "Alice", lastName: "Smith", status: "active" },
});
// #endregion test-migration

// ── #test-path ────────────────────────────────────────────────────────────────

// #region test-path
testMigrationPath(migrations, {
	from: 1,
	input: { firstName: "Alice", lastName: "Smith" },
	expectVersion: 3,
	expected: { fullName: "Alice Smith", status: "active" },
});
// #endregion test-path

// ── #test-restore ─────────────────────────────────────────────────────────────

// #region test-restore
testMigrationRestore(migrations, {
	from: 1,
	input: { firstName: "Alice", lastName: "Smith" },
	expectState: "Draft",
});
// #endregion test-restore

void MigrationError;
void migrationsV2;
void loadWorkflow;
void observedResult;
