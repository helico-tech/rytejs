import { describe, expect, test } from "vitest";
import { memoryStore } from "../../src/engine/memory-store.js";
import { WorkflowExecutor } from "../../src/executor/executor.js";
import { withStore } from "../../src/executor/with-store.js";
import { createFetch } from "../../src/http/http.js";
import { createTestRouter } from "../executor/helpers.js";

function makeRequest(method: string, path: string, body?: unknown): Request {
	const url = `http://localhost${path}`;
	const init: RequestInit = { method };
	if (body) {
		init.body = JSON.stringify(body);
		init.headers = { "Content-Type": "application/json" };
	}
	return new Request(url, init);
}

describe("createFetch", () => {
	function setup() {
		const store = memoryStore();
		const executor = new WorkflowExecutor(createTestRouter());
		executor.use(withStore(store));
		const handler = createFetch({ order: executor }, store);
		return { handler, store, executor };
	}

	test("PUT creates a workflow (201)", async () => {
		const { handler } = setup();
		const req = makeRequest("PUT", "/order/order-1", {
			initialState: "Draft",
			data: { items: ["widget"] },
		});
		const res = await handler(req);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.snapshot.state).toBe("Draft");
		expect(body.version).toBe(1);
	});

	test("GET loads a workflow (200)", async () => {
		const { handler } = setup();

		await handler(
			makeRequest("PUT", "/order/order-1", {
				initialState: "Draft",
				data: { items: ["widget"] },
			}),
		);

		const res = await handler(makeRequest("GET", "/order/order-1"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.snapshot.state).toBe("Draft");
		expect(body.version).toBe(1);
	});

	test("GET returns 404 for missing workflow", async () => {
		const { handler } = setup();
		const res = await handler(makeRequest("GET", "/order/missing"));
		expect(res.status).toBe(404);
	});

	test("POST executes a command (200)", async () => {
		const { handler } = setup();

		await handler(
			makeRequest("PUT", "/order/order-1", {
				initialState: "Draft",
				data: { items: ["widget"] },
			}),
		);

		const res = await handler(
			makeRequest("POST", "/order/order-1", {
				type: "Place",
				payload: {},
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.snapshot.state).toBe("Placed");
		expect(body.version).toBe(2);
		expect(body.events).toHaveLength(1);
	});

	test("POST returns 422 for domain error", async () => {
		const { handler } = setup();

		await handler(
			makeRequest("PUT", "/order/order-1", {
				initialState: "Draft",
				data: { items: [] },
			}),
		);

		const res = await handler(
			makeRequest("POST", "/order/order-1", {
				type: "Place",
				payload: {},
			}),
		);

		expect(res.status).toBe(422);
	});

	test("PUT returns 409 for duplicate", async () => {
		const { handler } = setup();

		await handler(
			makeRequest("PUT", "/order/order-1", {
				initialState: "Draft",
				data: { items: [] },
			}),
		);

		const res = await handler(
			makeRequest("PUT", "/order/order-1", {
				initialState: "Draft",
				data: { items: [] },
			}),
		);

		expect(res.status).toBe(409);
	});

	test("unknown executor returns 404", async () => {
		const { handler } = setup();
		const res = await handler(
			makeRequest("POST", "/unknown/id-1", {
				type: "Foo",
				payload: {},
			}),
		);
		expect(res.status).toBe(404);
	});
});
