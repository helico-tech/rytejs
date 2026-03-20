import Database from "better-sqlite3";
import { ConcurrencyConflictError } from "../../src/engine/errors.js";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "../../src/engine/types.js";

export interface SqliteStoreResult {
	store: StoreAdapter;
	getOutbox(): Array<{ workflowId: string; eventType: string; eventData: string }>;
	clearOutbox(): void;
	db: InstanceType<typeof Database>;
}

export function sqliteStore(): SqliteStoreResult {
	const db = new Database(":memory:");

	db.exec(`
		CREATE TABLE workflows (
			id TEXT PRIMARY KEY,
			snapshot TEXT NOT NULL,
			version INTEGER NOT NULL
		)
	`);

	db.exec(`
		CREATE TABLE outbox (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			workflow_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			event_data TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const store: StoreAdapter = {
		async load(id: string): Promise<StoredWorkflow | null> {
			const row = db.prepare("SELECT snapshot, version FROM workflows WHERE id = ?").get(id) as
				| { snapshot: string; version: number }
				| undefined;
			if (!row) return null;
			return { snapshot: JSON.parse(row.snapshot), version: row.version };
		},

		async save(options: SaveOptions): Promise<void> {
			const { id, snapshot, expectedVersion, events } = options;

			const txn = db.transaction(() => {
				const existing = db.prepare("SELECT version FROM workflows WHERE id = ?").get(id) as
					| { version: number }
					| undefined;
				const currentVersion = existing?.version ?? 0;

				if (currentVersion !== expectedVersion) {
					throw new ConcurrencyConflictError(id, expectedVersion, currentVersion);
				}

				if (existing) {
					db.prepare("UPDATE workflows SET snapshot = ?, version = ? WHERE id = ?").run(
						JSON.stringify(snapshot),
						currentVersion + 1,
						id,
					);
				} else {
					db.prepare("INSERT INTO workflows (id, snapshot, version) VALUES (?, ?, 1)").run(
						id,
						JSON.stringify(snapshot),
					);
				}

				if (events && events.length > 0) {
					const insert = db.prepare(
						"INSERT INTO outbox (workflow_id, event_type, event_data) VALUES (?, ?, ?)",
					);
					for (const event of events) {
						insert.run(id, event.type, JSON.stringify(event.data));
					}
				}
			});

			txn();
		},
	};

	return {
		store,
		getOutbox() {
			return db
				.prepare(
					"SELECT workflow_id as workflowId, event_type as eventType, event_data as eventData FROM outbox ORDER BY id",
				)
				.all() as Array<{ workflowId: string; eventType: string; eventData: string }>;
		},
		clearOutbox() {
			db.exec("DELETE FROM outbox");
		},
		db,
	};
}
