import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import type { BroadcastMessage } from "../../src/executor/types.js";
import { createSubscriberRegistry, withBroadcast } from "../../src/executor/with-broadcast.js";
import { withStore } from "../../src/executor/with-store.js";
import { memoryStore } from "../../src/store/memory-store.js";
import { createTestRouter } from "./helpers.js";

describe("createSubscriberRegistry", () => {
	test("subscribe and notify", () => {
		const registry = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];

		registry.subscribe("wf-1", (msg) => messages.push(msg));
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(messages).toHaveLength(1);
		expect(messages[0].version).toBe(1);
	});

	test("unsubscribe stops notifications", () => {
		const registry = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];

		const unsub = registry.subscribe("wf-1", (msg) => messages.push(msg));
		unsub();
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(messages).toHaveLength(0);
	});

	test("multiple subscribers per id", () => {
		const registry = createSubscriberRegistry();
		const a: BroadcastMessage[] = [];
		const b: BroadcastMessage[] = [];

		registry.subscribe("wf-1", (msg) => a.push(msg));
		registry.subscribe("wf-1", (msg) => b.push(msg));
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});

	test("notify only targets matching id", () => {
		const registry = createSubscriberRegistry();
		const a: BroadcastMessage[] = [];
		const b: BroadcastMessage[] = [];

		registry.subscribe("wf-1", (msg) => a.push(msg));
		registry.subscribe("wf-2", (msg) => b.push(msg));
		registry.notify("wf-1", { snapshot: {} as never, version: 1, events: [] });

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(0);
	});
});

describe("withBroadcast", () => {
	test("notifies subscribers after successful execution", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => messages.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withBroadcast(subscribers));
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		expect(messages).toHaveLength(1);
		expect(messages[0].version).toBe(1);
		expect(messages[0].snapshot.state).toBe("Draft");
	});

	test("does not notify on failed dispatch", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => messages.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withBroadcast(subscribers));
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: [] } });
		messages.length = 0; // clear create notification

		// Place on empty items → domain error
		await executor.execute("order-1", { type: "Place", payload: {} });

		expect(messages).toHaveLength(0);
	});

	test("broadcast includes events", async () => {
		const store = memoryStore();
		const subscribers = createSubscriberRegistry();
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("order-1", (msg) => messages.push(msg));

		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withBroadcast(subscribers));
		executor.use(withStore(store));

		await executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });
		await executor.execute("order-1", { type: "Place", payload: {} });

		const placeMsg = messages[1];
		expect(placeMsg.events).toHaveLength(1);
		expect(placeMsg.events[0].type).toBe("OrderPlaced");
	});
});
