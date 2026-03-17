import { describe, expect, test } from "vitest";
import { ConcurrencyConflictError } from "../../src/engine/errors.js";
import { memoryStore } from "../../src/engine/memory-store.js";

const makeSnapshot = (id: string, state = "Draft") => ({
	id,
	definitionName: "test",
	state,
	data: { title: "hello" },
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	modelVersion: 1,
});

describe("memoryStore", () => {
	test("load returns null for unknown workflow", async () => {
		const store = memoryStore();
		expect(await store.load("unknown")).toBeNull();
	});

	test("save with expectedVersion 0 creates a new record", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		const stored = await store.load("wf-1");
		expect(stored).not.toBeNull();
		expect(stored!.snapshot).toEqual(snapshot);
		expect(stored!.version).toBe(1);
	});

	test("save increments version on each call", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, expectedVersion: 0 });
		await store.save({ id: "wf-1", snapshot, expectedVersion: 1 });

		const stored = await store.load("wf-1");
		expect(stored!.version).toBe(2);
	});

	test("save throws ConcurrencyConflictError on version mismatch", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		await expect(store.save({ id: "wf-1", snapshot, expectedVersion: 0 })).rejects.toThrow(
			ConcurrencyConflictError,
		);
	});

	test("save with expectedVersion 0 throws if record already exists", async () => {
		const store = memoryStore();
		const snapshot = makeSnapshot("wf-1");
		await store.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		await expect(store.save({ id: "wf-1", snapshot, expectedVersion: 0 })).rejects.toThrow(
			ConcurrencyConflictError,
		);
	});
});
