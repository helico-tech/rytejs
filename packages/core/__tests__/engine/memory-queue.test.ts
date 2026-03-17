import { describe, expect, test, vi } from "vitest";
import { memoryQueue } from "../../src/engine/memory-queue.js";

describe("memoryQueue", () => {
	test("enqueue and dequeue round-trips messages", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "order", type: "Place", payload: { item: "x" } },
		]);

		const messages = await queue.dequeue(10);
		expect(messages).toHaveLength(1);
		expect(messages[0].workflowId).toBe("wf-1");
		expect(messages[0].routerName).toBe("order");
		expect(messages[0].type).toBe("Place");
		expect(messages[0].payload).toEqual({ item: "x" });
		expect(messages[0].attempt).toBe(0);
		expect(messages[0].id).toBeDefined();
	});

	test("dequeue returns empty array when queue is empty", async () => {
		const queue = memoryQueue();
		expect(await queue.dequeue(10)).toEqual([]);
	});

	test("dequeue respects count limit", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
			{ workflowId: "wf-2", routerName: "r", type: "B", payload: {} },
			{ workflowId: "wf-3", routerName: "r", type: "C", payload: {} },
		]);

		const messages = await queue.dequeue(2);
		expect(messages).toHaveLength(2);
	});

	test("ack removes message permanently", async () => {
		const queue = memoryQueue();
		await queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);

		const [msg] = await queue.dequeue(1);
		await queue.ack(msg.id);
		expect(await queue.dequeue(10)).toEqual([]);
	});

	test("nack re-enqueues message with incremented attempt", async () => {
		const queue = memoryQueue();
		await queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);

		const [msg] = await queue.dequeue(1);
		expect(msg.attempt).toBe(0);
		await queue.nack(msg.id);

		const [retried] = await queue.dequeue(1);
		expect(retried.attempt).toBe(1);
		expect(retried.workflowId).toBe("wf-1");
	});

	test("nack with delay hides message until delay expires", async () => {
		vi.useFakeTimers();
		const queue = memoryQueue();
		await queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);

		const [msg] = await queue.dequeue(1);
		await queue.nack(msg.id, 1_000);

		expect(await queue.dequeue(10)).toEqual([]);

		vi.advanceTimersByTime(1_001);
		const [retried] = await queue.dequeue(1);
		expect(retried.attempt).toBe(1);
		vi.useRealTimers();
	});

	test("deadLetter removes message from queue", async () => {
		const queue = memoryQueue();
		await queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);

		const [msg] = await queue.dequeue(1);
		await queue.deadLetter(msg.id, "test_reason");
		expect(await queue.dequeue(10)).toEqual([]);
	});

	test("dequeued messages are not visible to subsequent dequeue until ack/nack", async () => {
		const queue = memoryQueue();
		await queue.enqueue([{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} }]);

		const first = await queue.dequeue(1);
		expect(first).toHaveLength(1);
		const second = await queue.dequeue(1);
		expect(second).toHaveLength(0);
	});

	test("enqueue multiple messages in one call", async () => {
		const queue = memoryQueue();
		await queue.enqueue([
			{ workflowId: "wf-1", routerName: "r", type: "A", payload: {} },
			{ workflowId: "wf-2", routerName: "r", type: "B", payload: {} },
		]);

		const messages = await queue.dequeue(10);
		expect(messages).toHaveLength(2);
		expect(messages[0].id).not.toBe(messages[1].id);
	});
});
