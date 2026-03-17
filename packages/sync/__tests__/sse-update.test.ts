import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sseUpdateTransport } from "../src/transports/sse-update.js";
import type { UpdateMessage } from "../src/types.js";

function createMockSSEResponse(messages: string[]): Response {
	const encoder = new TextEncoder();
	let index = 0;
	const stream = new ReadableStream({
		pull(controller) {
			if (index < messages.length) {
				controller.enqueue(encoder.encode(messages[index]!));
				index++;
			} else {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

describe("sseUpdateTransport", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("opens SSE connection to correct URL", () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([]));

		const transport = sseUpdateTransport({
			url: "http://localhost:3000/api",
			router: "orders",
		});
		transport.subscribe("wf-1", vi.fn());

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:3000/api/orders/wf-1/events",
			expect.objectContaining({
				headers: expect.objectContaining({ Accept: "text/event-stream" }),
			}),
		);
	});

	test("parses SSE messages and calls listener", async () => {
		const snapshot = {
			id: "wf-1",
			definitionName: "orders",
			state: "Draft",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		const message = `data: ${JSON.stringify({ snapshot, version: 1 })}\n\n`;

		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([message]));

		const listener = vi.fn();
		const transport = sseUpdateTransport({
			url: "http://localhost:3000",
			router: "orders",
		});
		transport.subscribe("wf-1", listener);

		await vi.waitFor(() => {
			expect(listener).toHaveBeenCalledWith({ snapshot, version: 1 });
		});
	});

	test("handles multi-chunk SSE data", async () => {
		const snapshot = {
			id: "wf-1",
			definitionName: "orders",
			state: "Done",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		const fullMessage = `data: ${JSON.stringify({ snapshot, version: 2 })}\n\n`;
		const mid = Math.floor(fullMessage.length / 2);

		vi.mocked(globalThis.fetch).mockResolvedValue(
			createMockSSEResponse([fullMessage.slice(0, mid), fullMessage.slice(mid)]),
		);

		const listener = vi.fn();
		const transport = sseUpdateTransport({
			url: "http://localhost:3000",
			router: "orders",
		});
		transport.subscribe("wf-1", listener);

		await vi.waitFor(() => {
			expect(listener).toHaveBeenCalledWith({ snapshot, version: 2 });
		});
	});

	test("unsubscribe aborts the connection", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([]));

		const transport = sseUpdateTransport({
			url: "http://localhost:3000",
			router: "orders",
		});
		const sub = transport.subscribe("wf-1", vi.fn());
		sub.unsubscribe();

		// Verify the abort was called by checking fetch was called with an AbortSignal
		const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!;
		const fetchOptions = fetchCall[1] as RequestInit;
		expect(fetchOptions.signal).toBeDefined();
		expect(fetchOptions.signal!.aborted).toBe(true);
	});

	test("includes custom headers", () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(createMockSSEResponse([]));

		const transport = sseUpdateTransport({
			url: "http://localhost:3000",
			router: "orders",
			headers: { Authorization: "Bearer token" },
		});
		transport.subscribe("wf-1", vi.fn());

		expect(vi.mocked(globalThis.fetch).mock.calls[0]![1]).toMatchObject({
			headers: expect.objectContaining({ Authorization: "Bearer token" }),
		});
	});
});
