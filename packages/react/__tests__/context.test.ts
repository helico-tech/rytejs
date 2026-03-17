import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, test } from "vitest";
import { createWorkflowContext } from "../src/context.js";
import { createWorkflowStore } from "../src/store.js";
import type { WorkflowStore } from "../src/types.js";
import { createTestRouter, definition, type TodoConfig } from "./helpers.js";

const TodoWorkflow = createWorkflowContext(definition);

function createWrapper(store: WorkflowStore<TodoConfig>) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(TodoWorkflow.Provider, { store, children });
	};
}

describe("createWorkflowContext", () => {
	test("useWorkflow returns workflow state from context", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow(), {
			wrapper: createWrapper(store),
		});

		expect(result.current.state).toBe("Pending");
		expect(result.current.data).toEqual({ title: "Test" });
	});

	test("useWorkflow with selector from context", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow((w) => w.data.title), {
			wrapper: createWrapper(store),
		});

		expect(result.current).toBe("Test");
	});

	test("dispatch through context updates state", async () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow(), {
			wrapper: createWrapper(store),
		});

		await act(async () => {
			await result.current.dispatch("Start", { assignee: "Alice" });
		});

		expect(result.current.state).toBe("InProgress");
	});

	test("throws when used outside Provider", () => {
		expect(() => {
			renderHook(() => TodoWorkflow.useWorkflow());
		}).toThrow(/must be used within/i);
	});

	test("match works through context", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		const { result } = renderHook(() => TodoWorkflow.useWorkflow(), {
			wrapper: createWrapper(store),
		});

		const label = result.current.match({
			Pending: (data) => `pending: ${data.title}`,
			InProgress: (data) => `wip: ${data.assignee}`,
			Done: () => "done",
		});

		expect(label).toBe("pending: Test");
	});
});
