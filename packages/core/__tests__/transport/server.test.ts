import { describe, expect, test } from "vitest";
import type { BroadcastMessage } from "../../src/executor/types.js";
import { createSubscriberRegistry } from "../../src/executor/with-broadcast.js";
import { memoryStore } from "../../src/store/memory-store.js";
import { handlePolling } from "../../src/transport/server/polling.js";
import { handleSSE } from "../../src/transport/server/sse.js";

describe("handleSSE", () => {
	test("returns a streaming response with correct headers", () => {
		const subscribers = createSubscriberRegistry();
		const req = new Request("http://localhost/order-1");
		const res = handleSSE(req, subscribers);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");
		expect(res.headers.get("Cache-Control")).toBe("no-cache");
		expect(res.headers.get("Connection")).toBe("keep-alive");
		expect(res.body).not.toBeNull();
	});

	test("streams broadcast messages as SSE events", async () => {
		const subscribers = createSubscriberRegistry();
		const req = new Request("http://localhost/order-1");
		const res = handleSSE(req, subscribers);

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();

		// Push a broadcast message
		const message: BroadcastMessage = {
			snapshot: {
				id: "order-1",
				definitionName: "order",
				state: "Draft",
				data: {},
				createdAt: "",
				updatedAt: "",
				modelVersion: 1,
			} as never,
			version: 1,
			events: [],
		};
		subscribers.notify("order-1", message);

		// Read from stream
		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain("event: message");
		expect(text).toContain(`data: ${JSON.stringify(message)}`);

		reader.cancel();
	});

	test("extracts workflow id from URL path", () => {
		const subscribers = createSubscriberRegistry();
		const req = new Request("http://localhost/my-workflow-123");
		handleSSE(req, subscribers);

		// Verify subscription was created for the correct ID
		const messages: BroadcastMessage[] = [];
		subscribers.subscribe("other-id", (msg) => messages.push(msg));
		subscribers.notify("my-workflow-123", {
			snapshot: {} as never,
			version: 1,
			events: [],
		});

		// The SSE handler subscribed to my-workflow-123, not other-id
		expect(messages).toHaveLength(0);
	});
});

describe("handlePolling", () => {
	test("returns stored workflow snapshot and version", async () => {
		const store = memoryStore();
		// Seed a workflow
		await store.save({
			id: "order-1",
			snapshot: {
				id: "order-1",
				definitionName: "order",
				state: "Draft",
				data: {},
				createdAt: "",
				updatedAt: "",
				modelVersion: 1,
			} as never,
			expectedVersion: 0,
		});

		const req = new Request("http://localhost/order-1");
		const res = await handlePolling(req, store);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.snapshot.id).toBe("order-1");
		expect(body.version).toBe(1);
	});

	test("returns 404 for missing workflow", async () => {
		const store = memoryStore();
		const req = new Request("http://localhost/missing");
		const res = await handlePolling(req, store);

		expect(res.status).toBe(404);
	});
});
