import { ConcurrencyConflictError } from "@rytejs/core/engine";
import { describe, expect, test } from "vitest";
import { cloudflareStore } from "../src/adapters/store.js";

/** Mock DurableObjectStorage with an in-memory SQL backend */
function createMockStorage() {
	const rows = new Map<string, { id: string; snapshot: string; version: number }>();

	return {
		sql: {
			exec(query: string, ...bindings: unknown[]) {
				if (query.includes("CREATE TABLE")) {
					return { toArray: () => [], rowsWritten: 0 };
				}
				if (query.trimStart().startsWith("SELECT")) {
					const id = bindings[0] as string;
					const row = rows.get(id);
					return {
						toArray: () => (row ? [{ snapshot: row.snapshot, version: row.version }] : []),
						rowsWritten: 0,
					};
				}
				if (query.trimStart().startsWith("INSERT")) {
					const [id, snapshot, version] = bindings as [string, string, number];
					if (rows.has(id)) throw new Error("UNIQUE constraint failed: workflows.id");
					rows.set(id, { id, snapshot, version });
					return { toArray: () => [], rowsWritten: 1 };
				}
				if (query.trimStart().startsWith("UPDATE")) {
					const [snapshot, newVersion, id, expectedVersion] = bindings as [
						string,
						number,
						string,
						number,
					];
					const row = rows.get(id);
					if (!row || row.version !== expectedVersion) {
						return { toArray: () => [], rowsWritten: 0 };
					}
					rows.set(id, { id, snapshot, version: newVersion });
					return { toArray: () => [], rowsWritten: 1 };
				}
				return { toArray: () => [], rowsWritten: 0 };
			},
		},
	};
}

describe("cloudflareStore", () => {
	test("load returns null for non-existent workflow", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		expect(await store.load("missing")).toBeNull();
	});

	test("save creates new workflow with expectedVersion 0", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot = {
			id: "wf-1",
			state: "Draft",
			data: {},
			definitionName: "order",
			createdAt: "",
			updatedAt: "",
			modelVersion: 1,
		};

		await store.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 0 });
		const loaded = await store.load("wf-1");

		expect(loaded).not.toBeNull();
		expect(loaded!.version).toBe(1);
		expect(loaded!.snapshot).toEqual(snapshot);
	});

	test("save updates existing workflow with correct expectedVersion", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot1 = {
			id: "wf-1",
			state: "Draft",
			data: {},
			definitionName: "order",
			createdAt: "",
			updatedAt: "",
			modelVersion: 1,
		};
		const snapshot2 = { ...snapshot1, state: "Submitted" };

		await store.save({ id: "wf-1", snapshot: snapshot1 as never, expectedVersion: 0 });
		await store.save({ id: "wf-1", snapshot: snapshot2 as never, expectedVersion: 1 });
		const loaded = await store.load("wf-1");

		expect(loaded!.version).toBe(2);
		expect(loaded!.snapshot).toEqual(snapshot2);
	});

	test("save throws ConcurrencyConflictError on version mismatch", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot = {
			id: "wf-1",
			state: "Draft",
			data: {},
			definitionName: "order",
			createdAt: "",
			updatedAt: "",
			modelVersion: 1,
		};

		await store.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 0 });

		const err = await store
			.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 0 })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ConcurrencyConflictError);
		expect((err as ConcurrencyConflictError).expectedVersion).toBe(0);
		expect((err as ConcurrencyConflictError).actualVersion).toBe(1);
	});

	test("save throws ConcurrencyConflictError when updating non-existent workflow", async () => {
		const storage = createMockStorage();
		const store = cloudflareStore(storage as never);
		const snapshot = {
			id: "wf-1",
			state: "Draft",
			data: {},
			definitionName: "order",
			createdAt: "",
			updatedAt: "",
			modelVersion: 1,
		};

		await expect(
			store.save({ id: "wf-1", snapshot: snapshot as never, expectedVersion: 5 }),
		).rejects.toThrow(ConcurrencyConflictError);
	});
});
