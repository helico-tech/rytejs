import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { pollingTransport } from "../../src/transport/polling.js";
import { createTestRouter } from "../executor/helpers.js";
import { createMockServer } from "./helpers.js";

describe("pollingTransport", () => {
	let server: ReturnType<typeof createMockServer>;

	beforeEach(() => {
		server = createMockServer(createTestRouter());
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const req = new Request(url, init);
			return server.fetch(req);
		});
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	test("dispatch sends POST and returns result", async () => {
		await server.executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const transport = pollingTransport("http://localhost");
		const result = await transport.dispatch("order-1", { type: "Place", payload: {} }, 1);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.state).toBe("Placed");
		expect(result.version).toBe(2);
	});

	test("dispatch maps network errors to transport error", async () => {
		vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

		const transport = pollingTransport("http://localhost");
		const result = await transport.dispatch("order-1", { type: "Place", payload: {} }, 1);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("transport");
	});

	test("subscribe polls and calls callback on version change", async () => {
		await server.executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const transport = pollingTransport("http://localhost", 1000);
		const messages: unknown[] = [];
		const sub = transport.subscribe("order-1", (msg) => messages.push(msg));

		// First poll — initial state
		await vi.advanceTimersByTimeAsync(1000);
		expect(messages).toHaveLength(1);

		// Execute a command to change state
		await server.executor.execute("order-1", { type: "Place", payload: {} });

		// Second poll — should detect version change
		await vi.advanceTimersByTimeAsync(1000);
		expect(messages).toHaveLength(2);

		// Third poll — no change, no callback
		await vi.advanceTimersByTimeAsync(1000);
		expect(messages).toHaveLength(2);

		sub.unsubscribe();
	});

	test("unsubscribe stops polling", async () => {
		await server.executor.create("order-1", { initialState: "Draft", data: { items: [] } });

		const transport = pollingTransport("http://localhost", 1000);
		const messages: unknown[] = [];
		const sub = transport.subscribe("order-1", (msg) => messages.push(msg));

		await vi.advanceTimersByTimeAsync(1000);
		sub.unsubscribe();

		await vi.advanceTimersByTimeAsync(5000);
		expect(messages).toHaveLength(1); // only the first poll
	});
});
