import { describe, expect, test } from "vitest";
import { memoryStore } from "../../src/engine/memory-store.js";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import type { BroadcastMessage } from "../../src/executor/types.js";
import { createSubscriberRegistry, withBroadcast } from "../../src/executor/with-broadcast.js";
import { withStore } from "../../src/executor/with-store.js";
import { createTestRouter } from "../executor/helpers.js";

describe("executor integration", () => {
	test("full lifecycle: create → execute → broadcast → version increment", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const broadcasts: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => broadcasts.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withBroadcast(subscribers));
		executor.use(withStore(store));

		// Create
		const created = await executor.create("order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.version).toBe(1);
		expect(broadcasts).toHaveLength(1);

		// Execute
		const placed = await executor.execute("order-1", { type: "Place", payload: {} });
		expect(placed.ok).toBe(true);
		if (!placed.ok) return;
		expect(placed.version).toBe(2);
		expect(placed.snapshot.state).toBe("Placed");
		expect(placed.events[0].type).toBe("OrderPlaced");
		expect(broadcasts).toHaveLength(2);
		expect(broadcasts[1].version).toBe(2);
		expect(broadcasts[1].events[0].type).toBe("OrderPlaced");
	});

	test("concurrent writes: one succeeds, one gets conflict", async () => {
		const store = memoryStore();
		const exec1 = new WorkflowExecutor(createTestRouter());
		exec1.use(withStore(store));
		const exec2 = new WorkflowExecutor(createTestRouter());
		exec2.use(withStore(store));

		await exec1.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const [r1, r2] = await Promise.all([
			exec1.execute("order-1", { type: "AddItem", payload: { item: "b" } }),
			exec2.execute("order-1", { type: "AddItem", payload: { item: "c" } }),
		]);

		const successes = [r1, r2].filter((r) => r.ok);
		const conflicts = [r1, r2].filter((r) => !r.ok);
		expect(successes).toHaveLength(1);
		expect(conflicts).toHaveLength(1);
	});

	test("hooks fire in correct order", async () => {
		const store = memoryStore();
		const order: string[] = [];

		const executor = new WorkflowExecutor(createTestRouter());
		executor.on("execute:start", () => order.push("start"));
		executor.use(withStore(store));
		executor.on("execute:end", () => order.push("end"));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		expect(order).toEqual(["start", "end"]);
	});
});
