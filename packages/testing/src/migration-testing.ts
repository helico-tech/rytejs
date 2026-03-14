import type { MigrationPipeline, WorkflowConfig, WorkflowSnapshot } from "@rytejs/core";
import { migrate } from "@rytejs/core";

export interface TestMigrationOptions {
	from: number;
	input: unknown;
	expected: unknown;
	state?: string;
}

export interface TestMigrationPathOptions {
	from: number;
	input: unknown;
	expectVersion: number;
	expected: unknown;
	state?: string;
}

export interface TestMigrationRestoreOptions {
	from: number;
	input: unknown;
	expectState?: string;
	state?: string;
}

function makeTestSnapshot<TConfig extends WorkflowConfig>(
	pipeline: MigrationPipeline<TConfig>,
	version: number,
	data: unknown,
	state?: string,
): WorkflowSnapshot {
	const firstState = state ?? Object.keys(pipeline.definition.config.states)[0];
	if (!firstState) throw new Error("Definition has no states");
	return {
		id: `test-${Math.random().toString(36).slice(2, 9)}`,
		definitionName: pipeline.definition.name,
		state: firstState,
		data,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		modelVersion: version,
	};
}

function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Tests a single migration step.
 * Calls the migration function for (from + 1) directly and asserts output data matches expected.
 */
export function testMigration<TConfig extends WorkflowConfig>(
	pipeline: MigrationPipeline<TConfig>,
	options: TestMigrationOptions,
): void {
	const targetVersion = options.from + 1;
	const fn = pipeline.migrations.get(targetVersion);
	if (!fn) {
		throw new Error(`No migration function found for version ${targetVersion}`);
	}

	const snap = makeTestSnapshot(pipeline, options.from, options.input, options.state);
	const result = fn(snap);

	if (!deepEqual(result.data, options.expected)) {
		throw new Error(
			`Migration ${options.from} → ${targetVersion} data mismatch.\nExpected: ${JSON.stringify(options.expected)}\nGot: ${JSON.stringify(result.data)}`,
		);
	}
}

/**
 * Tests the full migration chain and asserts final version and data.
 */
export function testMigrationPath<TConfig extends WorkflowConfig>(
	pipeline: MigrationPipeline<TConfig>,
	options: TestMigrationPathOptions,
): void {
	const snap = makeTestSnapshot(pipeline, options.from, options.input, options.state);
	const result = migrate(pipeline, snap);

	if (!result.ok) {
		throw new Error(`Migration failed: ${result.error.message}`);
	}

	if (result.snapshot.modelVersion !== options.expectVersion) {
		throw new Error(
			`Expected final version ${options.expectVersion} but got ${result.snapshot.modelVersion}`,
		);
	}

	if (!deepEqual(result.snapshot.data, options.expected)) {
		throw new Error(
			`Migration path data mismatch.\nExpected: ${JSON.stringify(options.expected)}\nGot: ${JSON.stringify(result.snapshot.data)}`,
		);
	}
}

/**
 * Tests migrate + restore round-trip.
 * Derives the definition from the pipeline.
 */
export function testMigrationRestore<TConfig extends WorkflowConfig>(
	pipeline: MigrationPipeline<TConfig>,
	options: TestMigrationRestoreOptions,
): void {
	const snap = makeTestSnapshot(pipeline, options.from, options.input, options.state);
	const migrated = migrate(pipeline, snap);

	if (!migrated.ok) {
		throw new Error(`Migration failed: ${migrated.error.message}`);
	}

	const restored = pipeline.definition.restore(migrated.snapshot);

	if (!restored.ok) {
		throw new Error(`Restore failed after migration: ${restored.error.message}`);
	}

	if (options.expectState !== undefined && restored.workflow.state !== options.expectState) {
		throw new Error(`Expected state '${options.expectState}' but got '${restored.workflow.state}'`);
	}
}
