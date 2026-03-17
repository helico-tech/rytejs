import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowContext } from "../src/context.js";
import { createWorkflowStore } from "../src/store.js";
import type { WorkflowStore } from "../src/types.js";
import { createTestRouter, definition, type TodoConfig } from "./helpers.js";

const TodoWorkflow = createWorkflowContext(definition);

function TodoApp({ store }: { store: WorkflowStore<TodoConfig> }) {
	return createElement(
		TodoWorkflow.Provider,
		{ store },
		createElement(TodoView),
		createElement(StatusBadge),
	);
}

function TodoView() {
	const wf = TodoWorkflow.useWorkflow();

	return wf.match({
		Pending: (data) =>
			createElement(
				"div",
				null,
				createElement("h1", null, data.title),
				createElement(
					"button",
					{
						type: "button",
						onClick: () => wf.dispatch("Start", { assignee: "Alice" }),
						disabled: wf.isDispatching,
					},
					"Start",
				),
				createElement(
					"button",
					{ type: "button", onClick: () => wf.dispatch("Rename", { title: "Renamed" }) },
					"Rename",
				),
			),
		InProgress: (data) =>
			createElement(
				"div",
				null,
				createElement("h1", null, data.title),
				createElement("p", null, `Assigned to ${data.assignee}`),
				createElement(
					"button",
					{
						type: "button",
						onClick: () => wf.dispatch("Complete", {}),
						disabled: wf.isDispatching,
					},
					"Complete",
				),
			),
		Done: (data) =>
			createElement(
				"div",
				null,
				createElement("h1", null, `${data.title} — Done`),
				createElement("p", { "data-testid": "completed" }, "Completed"),
			),
	});
}

function StatusBadge() {
	const state = TodoWorkflow.useWorkflow((w) => w.state);
	return createElement("span", { "data-testid": "status" }, state);
}

describe("component integration", () => {
	afterEach(() => {
		cleanup();
	});

	test("renders initial state", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Buy groceries" },
		});

		render(createElement(TodoApp, { store }));

		expect(screen.getByText("Buy groceries")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
		expect(screen.getByTestId("status")).toHaveTextContent("Pending");
	});

	test("dispatch via button click transitions state", async () => {
		const user = userEvent.setup();
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Buy groceries" },
		});

		render(createElement(TodoApp, { store }));

		await user.click(screen.getByRole("button", { name: "Start" }));

		await waitFor(() => {
			expect(screen.getByText("Assigned to Alice")).toBeInTheDocument();
		});
		expect(screen.getByTestId("status")).toHaveTextContent("InProgress");
	});

	test("full workflow path: Pending → InProgress → Done", async () => {
		const user = userEvent.setup();
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Buy groceries" },
		});

		render(createElement(TodoApp, { store }));

		// Pending → InProgress
		await user.click(screen.getByRole("button", { name: "Start" }));
		await waitFor(() => {
			expect(screen.getByTestId("status")).toHaveTextContent("InProgress");
		});

		// InProgress → Done
		await user.click(screen.getByRole("button", { name: "Complete" }));
		await waitFor(() => {
			expect(screen.getByTestId("status")).toHaveTextContent("Done");
			expect(screen.getByTestId("completed")).toBeInTheDocument();
		});
	});

	test("update within same state (Rename)", async () => {
		const user = userEvent.setup();
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Original" },
		});

		render(createElement(TodoApp, { store }));

		expect(screen.getByText("Original")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() => {
			expect(screen.getByText("Renamed")).toBeInTheDocument();
		});
		expect(screen.getByTestId("status")).toHaveTextContent("Pending");
	});

	test("selector component updates independently", async () => {
		const user = userEvent.setup();
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		render(createElement(TodoApp, { store }));

		expect(screen.getByTestId("status")).toHaveTextContent("Pending");

		await user.click(screen.getByRole("button", { name: "Start" }));

		await waitFor(() => {
			expect(screen.getByTestId("status")).toHaveTextContent("InProgress");
		});
	});
});
