import { describe, expect, test } from "vitest";
import { routeToDO } from "../src/helpers/route-to-do.js";

function createMockEnv(binding: string) {
	const fetches: Array<{ id: string; request: Request }> = [];

	return {
		env: {
			[binding]: {
				idFromName(name: string) {
					return { name };
				},
				get(id: { name: string }) {
					return {
						fetch(request: Request) {
							fetches.push({ id: id.name, request });
							return Promise.resolve(new Response("ok"));
						},
					};
				},
			},
		},
		fetches,
	};
}

describe("routeToDO", () => {
	test("routes POST /:router/:id/dispatch to correct DO", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-123/dispatch", {
			method: "POST",
			body: JSON.stringify({ type: "Submit", payload: {} }),
		});

		await routeToDO(request, env as never, "WORKFLOW_DO");

		expect(fetches).toHaveLength(1);
		expect(fetches[0].id).toBe("order:wf-123");
		expect(fetches[0].request.method).toBe("POST");
		expect(new URL(fetches[0].request.url).pathname).toBe("/dispatch");
		expect(fetches[0].request.headers.get("X-Router-Name")).toBe("order");
	});

	test("routes GET /:router/:id/events to correct DO", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-123/events");

		await routeToDO(request, env as never, "WORKFLOW_DO");

		expect(fetches[0].id).toBe("order:wf-123");
		expect(new URL(fetches[0].request.url).pathname).toBe("/events");
		expect(fetches[0].request.headers.get("X-Router-Name")).toBe("order");
	});

	test("routes PUT /:router/:id/create to correct DO", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-456/create", {
			method: "PUT",
			body: JSON.stringify({ initialState: "Draft", data: {} }),
		});

		await routeToDO(request, env as never, "WORKFLOW_DO");

		expect(fetches[0].id).toBe("order:wf-456");
		expect(new URL(fetches[0].request.url).pathname).toBe("/create");
	});

	test("returns 400 for URLs with fewer than 2 path segments", async () => {
		const { env } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order");

		const response = await routeToDO(request, env as never, "WORKFLOW_DO");
		expect(response.status).toBe(400);
	});

	test("preserves query parameters", async () => {
		const { env, fetches } = createMockEnv("WORKFLOW_DO");
		const request = new Request("https://example.com/order/wf-1/snapshot?format=full");

		await routeToDO(request, env as never, "WORKFLOW_DO");

		const forwardedUrl = new URL(fetches[0].request.url);
		expect(forwardedUrl.pathname).toBe("/snapshot");
		expect(forwardedUrl.searchParams.get("format")).toBe("full");
	});
});
