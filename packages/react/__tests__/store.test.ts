import { composeSyncTransport } from "@rytejs/sync";
import { mockCommandTransport, mockUpdateTransport } from "@rytejs/sync/testing";
import { describe, expect, test, vi } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { createTestRouter, definition } from "./helpers.js";

describe("createWorkflowStore", () => {
	test("creates store with initial workflow in specified state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snapshot = store.getSnapshot();
		expect(snapshot.workflow.state).toBe("Pending");
		expect(snapshot.workflow.data).toEqual({ title: "Test" });
		expect(snapshot.isDispatching).toBe(false);
		expect(snapshot.error).toBeNull();
	});

	test("creates workflow with custom id", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
			id: "custom-id",
		});

		expect(store.getWorkflow().id).toBe("custom-id");
	});

	test("creates workflow with generated id when not provided", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		expect(store.getWorkflow().id).toBeTruthy();
		expect(typeof store.getWorkflow().id).toBe("string");
	});

	test("dispatch updates workflow on success", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(true);
		expect(store.getSnapshot().workflow.state).toBe("InProgress");
		expect(store.getSnapshot().workflow.data).toMatchObject({ assignee: "Alice" });
	});

	test("dispatch returns DispatchResult on failure", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		const result = await store.dispatch("Start", { assignee: "Alice" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("router");
		}
	});

	test("dispatch sets error on failure", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		await store.dispatch("Start", { assignee: "Alice" });

		const snapshot = store.getSnapshot();
		expect(snapshot.error).not.toBeNull();
		expect(snapshot.error?.category).toBe("router");
	});

	test("error clears on next successful dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		// Dispatch a command with no handler in Pending → sets error
		await store.dispatch("Complete", {});
		expect(store.getSnapshot().error).not.toBeNull();

		// Dispatch a valid command → should clear error
		await store.dispatch("Rename", { title: "Renamed" });
		expect(store.getSnapshot().error).toBeNull();
		expect(store.getSnapshot().workflow.data).toMatchObject({ title: "Renamed" });
	});

	test("isDispatching is true during dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snapshots: Array<{ isDispatching: boolean }> = [];
		store.subscribe(() => {
			snapshots.push({ isDispatching: store.getSnapshot().isDispatching });
		});

		await store.dispatch("Start", { assignee: "Alice" });

		// First notification: isDispatching=true, second: isDispatching=false
		expect(snapshots).toEqual([{ isDispatching: true }, { isDispatching: false }]);
	});

	test("subscribe notifies on dispatch (twice: start + end)", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const listener = vi.fn();
		store.subscribe(listener);
		await store.dispatch("Start", { assignee: "Alice" });

		// Called twice: isDispatching=true, then completion
		expect(listener).toHaveBeenCalledTimes(2);
	});

	test("unsubscribe stops notifications", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const listener = vi.fn();
		const unsub = store.subscribe(listener);
		unsub();
		await store.dispatch("Start", { assignee: "Alice" });

		expect(listener).not.toHaveBeenCalled();
	});

	test("getSnapshot returns same reference when nothing changed", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snap1 = store.getSnapshot();
		const snap2 = store.getSnapshot();
		expect(snap1).toBe(snap2);
	});

	test("getSnapshot returns new reference after dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const snap1 = store.getSnapshot();
		await store.dispatch("Start", { assignee: "Alice" });
		const snap2 = store.getSnapshot();
		expect(snap1).not.toBe(snap2);
	});

	test("setWorkflow replaces the workflow and notifies", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const listener = vi.fn();
		store.subscribe(listener);

		const newWorkflow = definition.createWorkflow("new-id", {
			initialState: "Done",
			data: { title: "Done", completedAt: new Date() },
		});
		store.setWorkflow(newWorkflow);

		expect(store.getSnapshot().workflow.state).toBe("Done");
		expect(store.getSnapshot().workflow.id).toBe("new-id");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	test("setWorkflow clears error", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		await store.dispatch("Start", { assignee: "Alice" });
		expect(store.getSnapshot().error).not.toBeNull();

		const newWorkflow = definition.createWorkflow("id", {
			initialState: "Pending",
			data: { title: "Fresh" },
		});
		store.setWorkflow(newWorkflow);
		expect(store.getSnapshot().error).toBeNull();
	});

	test("dispatch function is a stable reference", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const d1 = store.dispatch;
		const d2 = store.dispatch;
		expect(d1).toBe(d2);
	});
});

describe("sync store", () => {
	const router = createTestRouter();

	test("throws when sync is provided without id", () => {
		const transport = composeSyncTransport({
			commands: mockCommandTransport(() => ({ ok: true, snapshot: {} as never, version: 1 })),
			updates: mockUpdateTransport(),
		});

		expect(() =>
			createWorkflowStore(
				router,
				{ state: "Pending", data: { title: "Test" } },
				{ sync: transport },
			),
		).toThrow();
	});

	test("server-authoritative dispatch routes through transport", async () => {
		const snapshot = definition.snapshot(
			definition.createWorkflow("wf-1", {
				initialState: "Pending",
				data: { title: "Test" },
			}),
		);
		const handler = vi.fn().mockReturnValue({ ok: true, snapshot, version: 2 });
		const transport = composeSyncTransport({
			commands: mockCommandTransport(handler),
			updates: mockUpdateTransport(),
		});

		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ sync: transport },
		);

		await store.dispatch("Start", { assignee: "Alice" });

		expect(handler).toHaveBeenCalledWith("wf-1", {
			type: "Start",
			payload: { assignee: "Alice" },
		});
	});

	test("server-authoritative dispatch updates workflow from server snapshot", async () => {
		const transitioned = definition.createWorkflow("wf-1", {
			initialState: "InProgress",
			data: { title: "Test", assignee: "Alice" },
		});
		const snapshot = definition.snapshot(transitioned);

		const transport = composeSyncTransport({
			commands: mockCommandTransport(() => ({ ok: true, snapshot, version: 2 })),
			updates: mockUpdateTransport(),
		});

		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ sync: transport },
		);

		await store.dispatch("Start", { assignee: "Alice" });
		expect(store.getWorkflow().state).toBe("InProgress");
	});

	test("server-authoritative dispatch surfaces transport errors", async () => {
		const transport = composeSyncTransport({
			commands: mockCommandTransport(() => ({
				ok: false,
				error: { category: "transport", code: "NETWORK", message: "fail" },
			})),
			updates: mockUpdateTransport(),
		});

		const store = createWorkflowStore(
			router,
			{ state: "Pending", data: { title: "Test" }, id: "wf-1" },
			{ sync: transport },
		);

		const result = await store.dispatch("Start", { assignee: "Alice" });
		expect(result.ok).toBe(false);
		expect(store.getSnapshot().error).toMatchObject({ category: "transport" });
	});
});
