import { describe, expect, test, vi } from "vitest";
import { cloudflareBroadcaster } from "../src/adapters/broadcaster.js";

function createMockCtx() {
	const websockets: Array<{ send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
	return {
		acceptWebSocket(ws: unknown) {
			websockets.push(ws as (typeof websockets)[number]);
		},
		getWebSockets() {
			return [...websockets];
		},
		_websockets: websockets,
	};
}

describe("cloudflareBroadcaster", () => {
	test("handleSSE returns SSE response with correct headers", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const response = broadcaster.handleSSE();

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});

	test("broadcast sends to SSE clients", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const response = broadcaster.handleSSE();
		const reader = response.body!.getReader();

		const update = { snapshot: { id: "wf-1", state: "Draft" } as never, version: 2 };
		broadcaster.broadcast(update);

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain(`data: ${JSON.stringify(update)}`);
		reader.cancel();
	});

	test("handleWebSocket registers websocket via ctx.acceptWebSocket", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const mockWs = { send: vi.fn(), close: vi.fn() };

		broadcaster.handleWebSocket(mockWs as never);
		expect(ctx._websockets).toContain(mockWs);
	});

	test("broadcast sends to WebSocket clients", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);
		const mockWs = { send: vi.fn(), close: vi.fn() };

		broadcaster.handleWebSocket(mockWs as never);
		const update = { snapshot: { id: "wf-1", state: "Draft" } as never, version: 2 };
		broadcaster.broadcast(update);

		expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(update));
	});

	test("broadcast sends to both SSE and WebSocket clients", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		const sseResponse = broadcaster.handleSSE();
		const reader = sseResponse.body!.getReader();

		const mockWs = { send: vi.fn(), close: vi.fn() };
		broadcaster.handleWebSocket(mockWs as never);

		const update = { snapshot: { id: "wf-1", state: "Draft" } as never, version: 3 };
		broadcaster.broadcast(update);

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain(`data: ${JSON.stringify(update)}`);
		expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(update));
		reader.cancel();
	});

	test("connectionCount counts SSE and WebSocket clients", () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		expect(broadcaster.connectionCount()).toBe(0);

		broadcaster.handleSSE();
		expect(broadcaster.connectionCount()).toBe(1);

		broadcaster.handleWebSocket({ send: vi.fn(), close: vi.fn() } as never);
		expect(broadcaster.connectionCount()).toBe(2);
	});

	test("close closes all SSE controllers and WebSocket connections", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		broadcaster.handleSSE();
		const mockWs = { send: vi.fn(), close: vi.fn() };
		broadcaster.handleWebSocket(mockWs as never);

		expect(broadcaster.connectionCount()).toBe(2);
		broadcaster.close();

		expect(mockWs.close).toHaveBeenCalledWith(1000, "closing");
		// SSE controllers are cleared
		expect(broadcaster.connectionCount()).toBe(0);
	});

	test("SSE stream cancel cleans up controller", async () => {
		const ctx = createMockCtx();
		const broadcaster = cloudflareBroadcaster(ctx as never);

		const response = broadcaster.handleSSE();
		expect(broadcaster.connectionCount()).toBe(1);

		await response.body!.cancel();
		await new Promise((r) => setTimeout(r, 10));
		expect(broadcaster.connectionCount()).toBe(0);
	});
});
