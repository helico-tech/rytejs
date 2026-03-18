import type { StoreAdapter } from "@rytejs/core/engine";
import { ConcurrencyConflictError } from "@rytejs/core/engine";

export function cloudflareStore(storage: DurableObjectStorage): StoreAdapter {
	storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS workflows (
			id TEXT PRIMARY KEY,
			snapshot TEXT NOT NULL,
			version INTEGER NOT NULL
		)
	`);

	return {
		async load(id) {
			const rows = storage.sql
				.exec("SELECT snapshot, version FROM workflows WHERE id = ?", id)
				.toArray();

			if (rows.length === 0) return null;

			return {
				snapshot: JSON.parse(rows[0].snapshot as string),
				version: rows[0].version as number,
			};
		},

		async save({ id, snapshot, expectedVersion }) {
			const json = JSON.stringify(snapshot);
			const newVersion = expectedVersion + 1;

			if (expectedVersion === 0) {
				try {
					storage.sql.exec(
						"INSERT INTO workflows (id, snapshot, version) VALUES (?, ?, ?)",
						id,
						json,
						newVersion,
					);
				} catch {
					// Row exists — query actual version for the error
					const rows = storage.sql.exec("SELECT version FROM workflows WHERE id = ?", id).toArray();
					const actual = rows.length > 0 ? (rows[0].version as number) : -1;
					throw new ConcurrencyConflictError(id, expectedVersion, actual);
				}
				return;
			}

			const cursor = storage.sql.exec(
				"UPDATE workflows SET snapshot = ?, version = ? WHERE id = ? AND version = ?",
				json,
				newVersion,
				id,
				expectedVersion,
			);

			if (cursor.rowsWritten === 0) {
				// Version mismatch — query actual version for the error
				const rows = storage.sql.exec("SELECT version FROM workflows WHERE id = ?", id).toArray();
				const actual = rows.length > 0 ? (rows[0].version as number) : 0;
				throw new ConcurrencyConflictError(id, expectedVersion, actual);
			}
		},
	};
}
