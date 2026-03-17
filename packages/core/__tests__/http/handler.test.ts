import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { createEngine } from "../../src/engine/engine.js";
import { memoryStore } from "../../src/engine/memory-store.js";
import type { LockAdapter } from "../../src/engine/types.js";
import { createHandler } from "../../src/http/handler.js";
import { WorkflowRouter } from "../../src/router.js";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Complete: z.object({}),
		Cancel: z.object({}),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotReady: z.object({}),
	},
});

const taskRouter = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", { title: data.title, completedAt: new Date() });
			emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
		});
	})
	.state("Done", ({ on }) => {
		on("Complete", ({ error }) => {
			error({ code: "NotReady", data: {} });
		});
	});

function makeHandler(basePath?: string) {
	const store = memoryStore();
	const engine = createEngine({
		store,
		routers: { task: taskRouter },
	});
	return createHandler({ engine, basePath });
}

function jsonRequest(method: string, path: string, body?: unknown): Request {
	const init: RequestInit = {
		method,
		headers: { "Content-Type": "application/json" },
	};
	if (body !== undefined) init.body = JSON.stringify(body);
	return new Request(`http://localhost${path}`, init);
}

describe("createHandler", () => {
	test("PUT creates workflow → 201 with ok/workflow/version", async () => {
		const handler = makeHandler();
		const res = await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "Test" } }),
		);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot.id).toBe("task-1");
		expect(body.snapshot.state).toBe("Todo");
		expect(body.version).toBe(1);
	});

	test("PUT duplicate → 409", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "Test" } }),
		);
		const res = await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "Dup" } }),
		);
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	test("PUT unknown router → 404", async () => {
		const handler = makeHandler();
		const res = await handler(
			jsonRequest("PUT", "/unknown/task-1", { initialState: "Todo", data: { title: "X" } }),
		);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	test("PUT missing initialState → 400", async () => {
		const handler = makeHandler();
		const res = await handler(jsonRequest("PUT", "/task/task-1", { data: { title: "X" } }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("bad_request");
	});

	test("POST dispatches → 200 with ok/workflow/events/version", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "Ship" } }),
		);
		const res = await handler(
			jsonRequest("POST", "/task/task-1", { type: "Complete", payload: {} }),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot.state).toBe("Done");
		expect(body.events).toHaveLength(1);
		expect(body.events[0].type).toBe("TaskCompleted");
		expect(body.version).toBe(2);
	});

	test("POST missing workflow → 404", async () => {
		const handler = makeHandler();
		const res = await handler(
			jsonRequest("POST", "/task/nonexistent", { type: "Complete", payload: {} }),
		);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	test("POST router error (unknown command) → 400 with category", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "X" } }),
		);
		const res = await handler(jsonRequest("POST", "/task/task-1", { type: "Cancel", payload: {} }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("router");
	});

	test("POST domain error → 422 with category/code", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", {
				initialState: "Done",
				data: { title: "Done", completedAt: new Date().toISOString() },
			}),
		);
		const res = await handler(
			jsonRequest("POST", "/task/task-1", { type: "Complete", payload: {} }),
		);
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("domain");
		expect(body.error.code).toBe("NotReady");
	});

	test("POST missing command type → 400", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "X" } }),
		);
		const res = await handler(jsonRequest("POST", "/task/task-1", { payload: {} }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("bad_request");
	});

	test("GET returns workflow → 200 with ok/workflow/version", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "Read" } }),
		);
		const res = await handler(jsonRequest("GET", "/task/task-1"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot.id).toBe("task-1");
		expect(body.version).toBe(1);
	});

	test("GET missing workflow → 404", async () => {
		const handler = makeHandler();
		const res = await handler(jsonRequest("GET", "/task/nonexistent"));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	test("DELETE → 405", async () => {
		const handler = makeHandler();
		const res = await handler(jsonRequest("DELETE", "/task/task-1"));
		expect(res.status).toBe(405);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	test("POST missing Content-Type → 400", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "X" } }),
		);
		const res = await handler(
			new Request("http://localhost/task/task-1", {
				method: "POST",
				body: JSON.stringify({ type: "Complete", payload: {} }),
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("bad_request");
	});

	test("POST malformed JSON → 400", async () => {
		const handler = makeHandler();
		await handler(
			jsonRequest("PUT", "/task/task-1", { initialState: "Todo", data: { title: "X" } }),
		);
		const res = await handler(
			new Request("http://localhost/task/task-1", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{not valid json",
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("bad_request");
	});

	test("basePath prefix stripping works", async () => {
		const handler = makeHandler("/api/v1");
		const res = await handler(
			jsonRequest("PUT", "/api/v1/task/task-1", {
				initialState: "Todo",
				data: { title: "Base" },
			}),
		);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot.id).toBe("task-1");
	});

	test("POST returns 409 when lock is held", async () => {
		const alwaysLockedLock: LockAdapter = {
			acquire: async () => false,
			release: async () => {},
		};
		const lockedEngine = createEngine({
			store: memoryStore(),
			routers: { task: taskRouter },
			lock: alwaysLockedLock,
		});
		const lockedHandler = createHandler({ engine: lockedEngine });

		const res = await lockedHandler(
			new Request("http://localhost/task/task-1", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "Complete", payload: {} }),
			}),
		);

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.category).toBe("conflict");
	});
});
