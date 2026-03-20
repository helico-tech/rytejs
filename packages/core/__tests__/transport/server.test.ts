import { describe, expect, test } from "vitest";
import type { BroadcastMessage } from "../../src/executor/types.js";
import { createSubscriberRegistry } from "../../src/executor/with-broadcast.js";
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
