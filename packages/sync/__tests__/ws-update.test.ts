import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { UpdateMessage } from "../src/types.js";

/** Mock WebSocket that captures sent messages and allows simulating events */
class MockWebSocket {
	url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	closed = false;

	constructor(url: string) {
		this.url = url;
		// Auto-open on next tick (matches real WebSocket behavior)
		setTimeout(() => this.onopen?.(), 0);
	}

	close() {
		this.closed = true;
		this.onclose?.();
	}

	_receiveMessage(data: string) {
		this.onmessage?.({ data });
	}

	_error() {
		this.onerror?.({});
		// In real browsers, onerror is always followed by onclose
		this.onclose?.();
	}
}

let mockInstances: MockWebSocket[];

beforeEach(() => {
	mockInstances = [];
	vi.stubGlobal(
		"WebSocket",
		class extends MockWebSocket {
			constructor(url: string) {
				super(url);
				mockInstances.push(this);
			}
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Dynamic import so the module picks up the mocked global
const { wsUpdateTransport } = await import("../src/transports/ws-update.js");

describe("wsUpdateTransport", () => {
	test("subscribe opens WebSocket to correct URL", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost:3000/api", router: "order" });

		transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		expect(mockInstances).toHaveLength(1);
		expect(mockInstances[0].url).toBe("ws://localhost:3000/api/order/wf-1/websocket");
	});

	test("converts https to wss", async () => {
		const transport = wsUpdateTransport({ url: "https://example.com/api", router: "order" });

		transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		expect(mockInstances[0].url).toBe("wss://example.com/api/order/wf-1/websocket");
	});

	test("calls listener on incoming message", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost/api", router: "order" });
		const listener = vi.fn();

		transport.subscribe("wf-1", listener);
		await new Promise((r) => setTimeout(r, 10));

		const update: UpdateMessage = {
			snapshot: { id: "wf-1", state: "Draft" } as never,
			version: 2,
		};
		mockInstances[0]._receiveMessage(JSON.stringify(update));

		expect(listener).toHaveBeenCalledWith(update);
	});

	test("unsubscribe closes the WebSocket", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost/api", router: "order" });

		const sub = transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		sub.unsubscribe();
		expect(mockInstances[0].closed).toBe(true);
	});

	test("reconnects on error after delay", async () => {
		const transport = wsUpdateTransport({
			url: "http://localhost/api",
			router: "order",
			reconnectDelay: 50,
		});

		transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));
		expect(mockInstances).toHaveLength(1);

		// Simulate error
		mockInstances[0]._error();
		await new Promise((r) => setTimeout(r, 100));

		expect(mockInstances).toHaveLength(2);
	});

	test("does not reconnect after unsubscribe", async () => {
		const transport = wsUpdateTransport({
			url: "http://localhost/api",
			router: "order",
			reconnectDelay: 50,
		});

		const sub = transport.subscribe("wf-1", () => {});
		await new Promise((r) => setTimeout(r, 10));

		sub.unsubscribe();
		mockInstances[0]._error();
		await new Promise((r) => setTimeout(r, 100));

		// Should still only be 1 instance (no reconnect)
		expect(mockInstances).toHaveLength(1);
	});

	test("skips malformed messages", async () => {
		const transport = wsUpdateTransport({ url: "http://localhost/api", router: "order" });
		const listener = vi.fn();

		transport.subscribe("wf-1", listener);
		await new Promise((r) => setTimeout(r, 10));

		mockInstances[0]._receiveMessage("not json");
		expect(listener).not.toHaveBeenCalled();
	});
});
