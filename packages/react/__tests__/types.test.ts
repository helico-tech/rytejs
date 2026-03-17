import type { DispatchResult, PipelineError, Workflow } from "@rytejs/core";
import { describe, expectTypeOf, test } from "vitest";
import { createWorkflowContext } from "../src/context.js";
import { createWorkflowStore } from "../src/store.js";
import type { UseWorkflowReturn, WorkflowStore } from "../src/types.js";
import { useWorkflow } from "../src/use-workflow.js";
import { createTestRouter, definition, type TodoConfig } from "./helpers.js";

describe("type inference", () => {
	test("createWorkflowStore infers TConfig from router", () => {
		const router = createTestRouter();
		const store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		expectTypeOf(store).toMatchTypeOf<WorkflowStore<TodoConfig>>();
	});

	test("useWorkflow full mode returns UseWorkflowReturn", () => {
		const router = createTestRouter();
		const _store = createWorkflowStore(router, {
			state: "Pending",
			data: { title: "Test" },
		});

		expectTypeOf(useWorkflow<TodoConfig>)
			.parameter(0)
			.toMatchTypeOf<WorkflowStore<TodoConfig>>();
	});

	test("dispatch is typed with command names and payloads", () => {
		type Dispatch = UseWorkflowReturn<TodoConfig>["dispatch"];

		expectTypeOf<Dispatch>().toBeCallableWith("Start", { assignee: "Alice" });
		expectTypeOf<Dispatch>().toBeCallableWith("Complete", {});
		expectTypeOf<Dispatch>().toBeCallableWith("Rename", { title: "New" });
	});

	test("dispatch returns Promise<DispatchResult>", () => {
		type Dispatch = UseWorkflowReturn<TodoConfig>["dispatch"];
		type Return = ReturnType<Dispatch>;

		expectTypeOf<Return>().toMatchTypeOf<Promise<DispatchResult<TodoConfig>>>();
	});

	test("workflow is a discriminated union", () => {
		type W = UseWorkflowReturn<TodoConfig>["workflow"];

		expectTypeOf<W>().toMatchTypeOf<Workflow<TodoConfig>>();
	});

	test("error is PipelineError or null", () => {
		type E = UseWorkflowReturn<TodoConfig>["error"];

		expectTypeOf<E>().toMatchTypeOf<PipelineError<TodoConfig> | null>();
	});

	test("createWorkflowContext infers from definition", () => {
		const ctx = createWorkflowContext(definition);

		expectTypeOf(ctx.Provider).toBeFunction();
		expectTypeOf(ctx.useWorkflow).toBeFunction();
	});
});
