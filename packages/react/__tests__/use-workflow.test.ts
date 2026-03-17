import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { createWorkflowStore } from "../src/store.js";
import { useWorkflow } from "../src/use-workflow.js";
import { createTestRouter } from "./helpers.js";

describe("useWorkflow — full mode", () => {
	test("returns workflow state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		expect(result.current.workflow.state).toBe("Pending");
		expect(result.current.state).toBe("Pending");
		expect(result.current.data).toEqual({ title: "Test" });
		expect(result.current.isDispatching).toBe(false);
		expect(result.current.error).toBeNull();
	});

	test("updates after dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		await act(async () => {
			await store.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current.workflow.state).toBe("InProgress");
		expect(result.current.state).toBe("InProgress");
	});

	test("dispatch function works from the hook return", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		await act(async () => {
			const dispatchResult = await result.current.dispatch("Start", {
				assignee: "Alice",
			});
			expect(dispatchResult.ok).toBe(true);
		});

		expect(result.current.state).toBe("InProgress");
	});

	test("dispatch reference is stable across renders", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result, rerender } = renderHook(() => useWorkflow(store));
		const dispatch1 = result.current.dispatch;
		rerender();
		const dispatch2 = result.current.dispatch;

		expect(dispatch1).toBe(dispatch2);
	});

	test("error is set on failed dispatch", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Done",
			data: { title: "Test", completedAt: new Date() },
		});

		const { result } = renderHook(() => useWorkflow(store));

		await act(async () => {
			await result.current.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current.error).not.toBeNull();
		expect(result.current.error?.category).toBe("router");
	});
});

describe("useWorkflow — match", () => {
	test("exhaustive match returns correct value", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		const label = result.current.match({
			Pending: (data) => `pending: ${data.title}`,
			InProgress: (data) => `in-progress: ${data.assignee}`,
			Done: (data) => `done: ${data.title}`,
		});

		expect(label).toBe("pending: Test");
	});

	test("partial match with fallback uses fallback for unmatched state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "InProgress",
			data: { title: "Test", assignee: "Alice" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		const label = result.current.match({ Pending: () => "pending" }, (wf) => `other: ${wf.state}`);

		expect(label).toBe("other: InProgress");
	});

	test("partial match calls matcher when state matches", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store));

		const label = result.current.match(
			{ Pending: (data) => `found: ${data.title}` },
			() => "fallback",
		);

		expect(label).toBe("found: Test");
	});
});

describe("useWorkflow — selector mode", () => {
	test("returns selected value", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store, (w) => w.data.title));

		expect(result.current).toBe("Test");
	});

	test("updates when selected value changes", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => useWorkflow(store, (w) => w.state));

		expect(result.current).toBe("Pending");

		await act(async () => {
			await store.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current).toBe("InProgress");
	});

	test("selector with state narrowing", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "InProgress",
			data: { title: "Test", assignee: "Alice" },
		});

		const { result } = renderHook(() =>
			useWorkflow(store, (w) => (w.state === "InProgress" ? w.data.assignee : null)),
		);

		expect(result.current).toBe("Alice");
	});
});
