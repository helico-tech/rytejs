import { describe, expect, test } from "vitest";
import { memoryAdapter } from "../../src/engine/memory-adapter.js";
import type { TransactionalAdapter } from "../../src/engine/types.js";

const makeSnapshot = (id: string, state = "Draft") => ({
	id,
	definitionName: "test",
	state,
	data: { title: "hello" },
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	modelVersion: 1,
});

describe("memoryAdapter", () => {
	test("implements StoreAdapter: save and load", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const snapshot = makeSnapshot("wf-1");
		await adapter.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		const stored = await adapter.load("wf-1");
		expect(stored).not.toBeNull();
		expect(stored!.snapshot).toEqual(snapshot);
		expect(stored!.version).toBe(1);
	});

	test("implements QueueAdapter: enqueue and dequeue", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		await adapter.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);

		const messages = await adapter.dequeue(10);
		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("A");
	});

	test("implements LockAdapter: acquire and release", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		expect(await adapter.acquire("wf-1")).toBe(true);
		expect(await adapter.acquire("wf-1")).toBe(false);
		await adapter.release("wf-1");
		expect(await adapter.acquire("wf-1")).toBe(true);
	});

	test("implements TransactionalAdapter: atomic save + enqueue", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const snapshot = makeSnapshot("wf-1");

		await (adapter as TransactionalAdapter).transaction(async (tx) => {
			await tx.store.save({ id: "wf-1", snapshot, expectedVersion: 0 });
			await tx.queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);
		});

		const stored = await adapter.load("wf-1");
		expect(stored!.version).toBe(1);
		const messages = await adapter.dequeue(10);
		expect(messages).toHaveLength(1);
	});

	test("transaction rolls back both store and queue on error", async () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const snapshot = makeSnapshot("wf-1");

		// Pre-populate so we can verify rollback
		await adapter.save({ id: "wf-1", snapshot, expectedVersion: 0 });

		await expect(
			(adapter as TransactionalAdapter).transaction(async (tx) => {
				await tx.store.save({
					id: "wf-1",
					snapshot: makeSnapshot("wf-1", "Published"),
					expectedVersion: 1,
				});
				await tx.queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);
				throw new Error("Simulated failure");
			}),
		).rejects.toThrow("Simulated failure");

		// Store should not have the Published snapshot
		const stored = await adapter.load("wf-1");
		expect(stored!.snapshot.state).toBe("Draft");
		expect(stored!.version).toBe(1);

		// Queue should be empty
		expect(await adapter.dequeue(10)).toEqual([]);
	});

	test("store === queue identity check holds", () => {
		const adapter = memoryAdapter({ ttl: 5_000 });
		const store = adapter;
		const queue = adapter;
		expect(store === queue).toBe(true);
	});
});
