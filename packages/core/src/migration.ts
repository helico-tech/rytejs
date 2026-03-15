import type { WorkflowDefinition } from "./definition.js";
import type { WorkflowSnapshot } from "./snapshot.js";
import type { WorkflowConfig } from "./types.js";

/** A function that transforms a snapshot's data from one version to the next. */
export type MigrationFn = (snapshot: WorkflowSnapshot) => WorkflowSnapshot;

/** A migration entry — either a bare {@link MigrationFn} or an object with a description. */
export type MigrationEntry = MigrationFn | { description: string; up: MigrationFn };

/** Internal normalized migration step with optional description. */
interface NormalizedMigration {
	fn: MigrationFn;
	description?: string;
}

/** A validated migration pipeline ready to transform snapshots. */
export interface MigrationPipeline<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** The workflow definition this pipeline belongs to. */
	readonly definition: WorkflowDefinition<TConfig>;
	/** The target schema version to migrate snapshots to. */
	readonly targetVersion: number;
	/** Map of version number to normalized migration step. */
	readonly migrations: ReadonlyMap<number, NormalizedMigration>;
}

/** Result of {@link migrate}. */
export type MigrateResult =
	| { ok: true; snapshot: WorkflowSnapshot }
	| { ok: false; error: MigrationError };

/** Options for {@link migrate}. */
export interface MigrateOptions {
	/**
	 * Called after each successful migration step.
	 * @param fromVersion - The version before this step
	 * @param toVersion - The version after this step
	 * @param snapshot - The snapshot after this step
	 * @param description - Optional description from the migration entry
	 */
	onStep?: (
		fromVersion: number,
		toVersion: number,
		snapshot: WorkflowSnapshot,
		description?: string,
	) => void;
	/**
	 * Called when a migration step fails.
	 * @param error - The {@link MigrationError} describing the failure
	 */
	onError?: (error: MigrationError) => void;
}

/** Error thrown when a migration step fails. */
export class MigrationError extends Error {
	/**
	 * @param fromVersion - The schema version the migration started from
	 * @param toVersion - The schema version the migration was attempting to reach
	 * @param cause - The underlying error that caused the failure
	 */
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

/**
 * Creates a validated migration pipeline from a definition and version-keyed transform functions.
 * Each key is the target version — the function transforms from (key - 1) to key.
 *
 * @param definition - The workflow definition the migrations belong to
 * @param migrationMap - A record mapping target version numbers to {@link MigrationEntry} values
 * @returns A validated {@link MigrationPipeline} ready for use with {@link migrate}
 * @throws If migration keys are not sequential from 2 to the definition's `modelVersion`, or if the highest key does not match `modelVersion`
 */
export function defineMigrations<TConfig extends WorkflowConfig>(
	definition: WorkflowDefinition<TConfig>,
	migrationMap: Record<number, MigrationEntry>,
): MigrationPipeline<TConfig> {
	const targetVersion = definition.config.modelVersion ?? 1;
	const entries = Object.entries(migrationMap).map(([k, v]) => {
		const normalized: NormalizedMigration =
			typeof v === "function" ? { fn: v } : { fn: v.up, description: v.description };
		return [Number(k), normalized] as const;
	});

	for (const [version] of entries) {
		if (version <= 1) {
			throw new Error(`Migration keys must be > 1 (version 1 is the baseline). Got: ${version}`);
		}
	}

	entries.sort((a, b) => a[0] - b[0]);

	if (entries.length > 0) {
		const highest = entries[entries.length - 1];
		if (!highest || highest[0] !== targetVersion) {
			throw new Error(
				`Highest migration key (${highest?.[0]}) does not match definition modelVersion (${targetVersion})`,
			);
		}
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const expected = targetVersion - entries.length + 1 + i;
			if (!entry || entry[0] !== expected) {
				throw new Error(
					`Migration version gap: expected ${expected} but found ${entry?.[0]}. Migrations must be sequential from 2 to ${targetVersion}.`,
				);
			}
		}
	}

	return {
		definition,
		targetVersion,
		migrations: new Map(entries),
	};
}

/**
 * Runs the migration chain from the snapshot's modelVersion to the pipeline's targetVersion.
 * Returns a Result. Auto-stamps modelVersion after each step.
 *
 * @param pipeline - The {@link MigrationPipeline} created by {@link defineMigrations}
 * @param snapshot - The workflow snapshot to migrate
 * @param options - Optional callbacks for step progress and error reporting
 * @returns A {@link MigrateResult} with the migrated snapshot on success, or a {@link MigrationError} on failure
 */
export function migrate<TConfig extends WorkflowConfig>(
	pipeline: MigrationPipeline<TConfig>,
	snapshot: WorkflowSnapshot,
	options?: MigrateOptions,
): MigrateResult {
	if (!Number.isInteger(snapshot.modelVersion) || snapshot.modelVersion < 1) {
		const error = new MigrationError(
			snapshot.modelVersion,
			pipeline.targetVersion,
			new Error(
				`Invalid snapshot modelVersion: ${snapshot.modelVersion}. Must be a positive integer.`,
			),
		);
		options?.onError?.(error);
		return { ok: false, error };
	}

	if (snapshot.definitionName !== pipeline.definition.name) {
		const error = new MigrationError(
			snapshot.modelVersion,
			pipeline.targetVersion,
			new Error(
				`Snapshot definition '${snapshot.definitionName}' does not match pipeline definition '${pipeline.definition.name}'`,
			),
		);
		options?.onError?.(error);
		return { ok: false, error };
	}

	if (snapshot.modelVersion > pipeline.targetVersion) {
		const error = new MigrationError(
			snapshot.modelVersion,
			pipeline.targetVersion,
			new Error(
				`Snapshot modelVersion (${snapshot.modelVersion}) is higher than target (${pipeline.targetVersion}). Cannot downgrade.`,
			),
		);
		options?.onError?.(error);
		return { ok: false, error };
	}

	if (snapshot.modelVersion === pipeline.targetVersion) {
		return { ok: true, snapshot };
	}

	let current = { ...snapshot };
	for (let version = current.modelVersion + 1; version <= pipeline.targetVersion; version++) {
		const migration = pipeline.migrations.get(version);
		if (!migration) {
			const error = new MigrationError(
				version - 1,
				version,
				new Error(`No migration function found for version ${version}`),
			);
			options?.onError?.(error);
			return { ok: false, error };
		}

		const fromVersion = version - 1;
		try {
			current = { ...migration.fn(current), modelVersion: version };
		} catch (cause) {
			const error = new MigrationError(fromVersion, version, cause);
			options?.onError?.(error);
			return { ok: false, error };
		}

		options?.onStep?.(fromVersion, version, current, migration.description);
	}

	return { ok: true, snapshot: current };
}
