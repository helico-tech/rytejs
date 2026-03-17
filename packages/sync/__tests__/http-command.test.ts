import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { httpCommandTransport } from "../src/transports/http-command.js";

describe("httpCommandTransport", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("sends POST to correct URL with command body", async () => {
		const snapshot = {
			id: "wf-1",
			definitionName: "orders",
			state: "Draft",
			data: {},
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			modelVersion: 1,
		};
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, snapshot, version: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000/api",
			router: "orders",
		});
		const result = await transport.dispatch("wf-1", {
			type: "PlaceOrder",
			payload: { items: [] },
		});

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:3000/api/orders/wf-1",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ "Content-Type": "application/json" }),
				body: JSON.stringify({ type: "PlaceOrder", payload: { items: [] } }),
			}),
		);
		expect(result).toEqual({ ok: true, snapshot, version: 1 });
	});

	test("includes static headers", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, snapshot: {}, version: 1 }), {
				status: 200,
			}),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
			headers: { Authorization: "Bearer token123" },
		});
		await transport.dispatch("wf-1", { type: "Submit", payload: {} });

		expect(vi.mocked(globalThis.fetch).mock.calls[0]![1]).toMatchObject({
			headers: expect.objectContaining({ Authorization: "Bearer token123" }),
		});
	});

	test("includes dynamic headers from function", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, snapshot: {}, version: 1 }), {
				status: 200,
			}),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
			headers: () => ({ Authorization: "Bearer dynamic" }),
		});
		await transport.dispatch("wf-1", { type: "Submit", payload: {} });

		expect(vi.mocked(globalThis.fetch).mock.calls[0]![1]).toMatchObject({
			headers: expect.objectContaining({ Authorization: "Bearer dynamic" }),
		});
	});

	test("returns error result for pipeline errors", async () => {
		const error = {
			category: "validation",
			source: "command",
			issues: [],
			message: "bad",
		};
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(JSON.stringify({ ok: false, error }), { status: 400 }),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
		});
		const result = await transport.dispatch("wf-1", { type: "Bad", payload: {} });

		expect(result).toEqual({ ok: false, error });
	});

	test("returns transport error on network failure", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
		});
		const result = await transport.dispatch("wf-1", { type: "Submit", payload: {} });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("transport");
			expect((result.error as { code: string }).code).toBe("NETWORK");
		}
	});

	test("returns transport error on non-JSON response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response("Internal Server Error", { status: 500 }),
		);

		const transport = httpCommandTransport({
			url: "http://localhost:3000",
			router: "orders",
		});
		const result = await transport.dispatch("wf-1", { type: "Submit", payload: {} });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("transport");
			expect((result.error as { code: string }).code).toBe("PARSE");
		}
	});
});
