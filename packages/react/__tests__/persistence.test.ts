import { describe, expect, test } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter } from "./helpers.js";

function createMockStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
		clear: () => data.clear(),
		get length() {
			return data.size;
		},
		key: (index) => [...data.keys()][index] ?? null,
	};
}

describe("persistence", () => {
	test("saves snapshot to storage after successful dispatch", async () => {
		const storage = createMockStorage();
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" } },
			{ persist: { key: "test-workflow", storage } },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		const stored = storage.getItem("test-workflow");
		expect(stored).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		const parsed = JSON.parse(stored!);
		expect(parsed.state).toBe("InProgress");
	});

	test("does not save to storage on failed dispatch", async () => {
		const storage = createMockStorage();
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Done", data: { title: "Test", completedAt: new Date() } },
			{ persist: { key: "test-workflow", storage } },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		expect(storage.getItem("test-workflow")).toBeNull();
	});

	test("restores workflow from storage on creation", async () => {
		const storage = createMockStorage();
		const router = createTestRouter();

		// First store: dispatch to change state, which persists
		const store1 = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ persist: { key: "test-workflow", storage } },
		);
		await store1.dispatch("Start", { assignee: "Alice" });

		// Second store: should restore from storage
		const store2 = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "test-workflow", storage } },
		);

		expect(store2.getSnapshot().workflow!.state).toBe("InProgress");
		expect(store2.getSnapshot().workflow!.id).toBe("wf-1");
	});

	test("falls back to initial config when storage is empty", () => {
		const storage = createMockStorage();
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "nonexistent", storage } },
		);

		expect(store.getSnapshot().workflow!.state).toBe("Pending");
		expect(store.getSnapshot().workflow!.data).toEqual({ title: "Fallback" });
	});

	test("falls back to initial config when stored data is corrupt", () => {
		const storage = createMockStorage();
		storage.setItem("test-workflow", "not-json");
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "test-workflow", storage } },
		);

		expect(store.getSnapshot().workflow!.state).toBe("Pending");
	});

	test("falls back when stored snapshot fails validation", () => {
		const storage = createMockStorage();
		storage.setItem(
			"test-workflow",
			JSON.stringify({
				id: "old",
				definitionName: "todo",
				state: "Pending",
				data: { invalidField: true },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
				version: 1,
			}),
		);
		const router = createTestRouter();
		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Fallback" } },
			{ persist: { key: "test-workflow", storage } },
		);

		expect(store.getSnapshot().workflow!.state).toBe("Pending");
		expect(store.getSnapshot().workflow!.data).toEqual({ title: "Fallback" });
	});
});
