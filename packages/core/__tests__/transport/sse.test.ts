import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sseTransport } from "../../src/transport/sse.js";
import { createTestRouter } from "../executor/helpers.js";
import { createMockServer } from "./helpers.js";

describe("sseTransport", () => {
	let server: ReturnType<typeof createMockServer>;

	beforeEach(() => {
		server = createMockServer(createTestRouter());
		// Mock global fetch to route to our mock server
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const req = new Request(url, init);
			return server.fetch(req);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("dispatch sends POST and returns result", async () => {
		// Create a workflow first
		await server.executor.create("order-1", { initialState: "Draft", data: { items: ["a"] } });

		const transport = sseTransport("http://localhost");
		const result = await transport.dispatch("order-1", { type: "Place", payload: {} }, 1);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.snapshot.state).toBe("Placed");
		expect(result.version).toBe(2);
		expect(result.events).toHaveLength(1);
	});

	test("dispatch returns error for not found", async () => {
		const transport = sseTransport("http://localhost");
		const result = await transport.dispatch("missing", { type: "Place", payload: {} }, 1);

		expect(result.ok).toBe(false);
	});

	test("dispatch maps network errors to transport error", async () => {
		vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));

		const transport = sseTransport("http://localhost");
		const result = await transport.dispatch("order-1", { type: "Place", payload: {} }, 1);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("transport");
		if (result.error.category === "transport") {
			expect(result.error.code).toBe("NETWORK");
		}
	});

	test("subscribe returns a subscription object", () => {
		const transport = sseTransport("http://localhost");

		// EventSource may not be available in Node test env.
		// Verify subscribe returns a valid subscription.
		const sub = transport.subscribe("order-1", () => {});

		expect(sub).toBeDefined();
		expect(typeof sub.unsubscribe).toBe("function");

		sub.unsubscribe();
	});
});
