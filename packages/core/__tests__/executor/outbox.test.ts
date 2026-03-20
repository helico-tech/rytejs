import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { createTestRouter } from "./helpers.js";
import { sqliteStore } from "./sqlite-store.js";

describe("outbox pattern with SQLite", () => {
	test("snapshot and events are saved in one transaction", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["widget"] } });
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(true);

		// Verify snapshot was saved
		const stored = await store.load("order-1");
		expect(stored!.snapshot.state).toBe("Placed");
		expect(stored!.version).toBe(2);

		// Verify events in outbox
		const outbox = getOutbox();
		expect(outbox).toHaveLength(1);
		expect(outbox[0].workflowId).toBe("order-1");
		expect(outbox[0].eventType).toBe("OrderPlaced");
		expect(JSON.parse(outbox[0].eventData)).toEqual({ orderId: "order-1" });
	});

	test("failed dispatch writes nothing to outbox", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		expect(getOutbox()).toHaveLength(0);
	});

	test("create saves snapshot but no events in outbox", async () => {
		const { store, getOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		const stored = await store.load("order-1");
		expect(stored!.version).toBe(1);
		expect(getOutbox()).toHaveLength(0);
	});

	test("version conflict rolls back both snapshot and events", async () => {
		const { store, getOutbox, db } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		// Insert a middleware after withStore that simulates a concurrent write
		// by bumping the DB version after withStore loaded but before it saves.
		// In the onion model: withStore loads → this middleware runs → core handler
		// → this middleware returns → withStore tries to save (version mismatch).
		let bumped = false;
		executor.use(async (ctx, next) => {
			if (!bumped && ctx.operation === "execute") {
				bumped = true;
				db.exec("UPDATE workflows SET version = 99 WHERE id = 'order-1'");
			}
			await next();
		});

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const result = await executor.execute("order-1", { type: "Place", payload: {} });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("conflict");
		}

		// No events should have been written
		expect(getOutbox()).toHaveLength(0);

		// Snapshot should be unchanged (version 99, not updated)
		const stored = await store.load("order-1");
		expect(stored!.version).toBe(99);
	});

	test("outbox survives after clearing and re-executing", async () => {
		const { store, getOutbox, clearOutbox } = sqliteStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		expect(getOutbox()).toHaveLength(1);
		clearOutbox();
		expect(getOutbox()).toHaveLength(0);

		// Create another workflow and execute
		await executor.create("order-2", { initialState: "Draft", data: { items: ["b"] } });
		await executor.execute("order-2", { type: "Place", payload: {} });

		expect(getOutbox()).toHaveLength(1);
		expect(getOutbox()[0].workflowId).toBe("order-2");
	});
});
