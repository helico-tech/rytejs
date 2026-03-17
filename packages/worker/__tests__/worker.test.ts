import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { memoryAdapter } from "@rytejs/core/engine";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createWorker } from "../src/worker.js";

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string() }),
		Done: z.object({
			title: z.string(),
			completedAt: z.coerce.date(),
		}),
	},
	commands: {
		Complete: z.object({}),
	},
	events: {
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		AlreadyDone: z.object({}),
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
			error({ code: "AlreadyDone", data: {} });
		});
	});

function makeWorker(overrides?: Partial<Parameters<typeof createWorker>[0]>) {
	const adapter = memoryAdapter({ ttl: 30_000 });
	return {
		worker: createWorker({
			routers: [taskRouter],
			store: adapter,
			queue: adapter,
			lock: adapter,
			concurrency: 1,
			pollInterval: 50,
			...overrides,
		}),
		adapter,
	};
}

describe("createWorker", () => {
	test("throws if routers have duplicate definition names", () => {
		const adapter = memoryAdapter({ ttl: 30_000 });
		expect(() =>
			createWorker({
				routers: [taskRouter, taskRouter],
				store: adapter,
				queue: adapter,
			}),
		).toThrow("Duplicate router definition name");
	});
});

describe("worker.send()", () => {
	test("enqueues a command to the queue", async () => {
		const { worker, adapter } = makeWorker();
		await worker.send(taskRouter, "task-1", {
			type: "Complete",
			payload: {},
		});

		const messages = await adapter.dequeue(10);
		expect(messages).toHaveLength(1);
		expect(messages[0]!.workflowId).toBe("task-1");
		expect(messages[0]!.routerName).toBe("task");
		expect(messages[0]!.type).toBe("Complete");
	});
});

describe("worker poll loop", () => {
	test("processes a command from the queue", async () => {
		const { worker, adapter } = makeWorker();

		await adapter.save({
			id: "task-1",
			snapshot: {
				id: "task-1",
				definitionName: "task",
				state: "Todo",
				data: { title: "Test" },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
			},
			expectedVersion: 0,
		});

		await worker.send(taskRouter, "task-1", {
			type: "Complete",
			payload: {},
		});

		await worker.start();
		await new Promise((r) => setTimeout(r, 200));
		await worker.stop();

		const stored = await adapter.load("task-1");
		expect(stored!.snapshot.state).toBe("Done");
	});

	test("dead-letters commands for unknown routers", async () => {
		const { worker, adapter } = makeWorker();

		await adapter.enqueue([
			{
				workflowId: "wf-1",
				routerName: "unknown",
				type: "Foo",
				payload: {},
			},
		]);

		await worker.start();
		await new Promise((r) => setTimeout(r, 200));
		await worker.stop();

		expect(await adapter.dequeue(10)).toEqual([]);
	});
});

describe("worker lifecycle hooks", () => {
	test("emits command:started and command:completed", async () => {
		const { worker, adapter } = makeWorker();
		const started = vi.fn();
		const completed = vi.fn();

		worker.on("command:started", started);
		worker.on("command:completed", completed);

		await adapter.save({
			id: "task-1",
			snapshot: {
				id: "task-1",
				definitionName: "task",
				state: "Todo",
				data: { title: "Test" },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelVersion: 1,
			},
			expectedVersion: 0,
		});

		await worker.send(taskRouter, "task-1", {
			type: "Complete",
			payload: {},
		});
		await worker.start();
		await new Promise((r) => setTimeout(r, 200));
		await worker.stop();

		expect(started).toHaveBeenCalledTimes(1);
		expect(completed).toHaveBeenCalledTimes(1);
	});
});

describe("worker.stop()", () => {
	test("stops polling and resolves", async () => {
		const { worker } = makeWorker();
		await worker.start();
		await worker.stop();
	});
});
