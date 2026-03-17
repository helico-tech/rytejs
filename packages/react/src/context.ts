import type { Workflow, WorkflowConfig, WorkflowDefinition } from "@rytejs/core";
import type { ReactNode } from "react";
import { createContext, createElement, useContext } from "react";
import type { UseWorkflowReturn, WorkflowStore } from "./types.js";
import { useWorkflow } from "./use-workflow.js";

export function createWorkflowContext<TConfig extends WorkflowConfig>(
	_definition: WorkflowDefinition<TConfig>,
): {
	Provider: (props: { store: WorkflowStore<TConfig>; children: ReactNode }) => ReactNode;
	useWorkflow: {
		(): UseWorkflowReturn<TConfig>;
		<R>(selector: (workflow: Workflow<TConfig>) => R, equalityFn?: (a: R, b: R) => boolean): R;
	};
} {
	const StoreContext = createContext<WorkflowStore<TConfig> | null>(null);

	function Provider({
		store,
		children,
	}: {
		store: WorkflowStore<TConfig>;
		children: ReactNode;
	}): ReactNode {
		return createElement(StoreContext.Provider, { value: store }, children);
	}

	function useWorkflowFromContext(): UseWorkflowReturn<TConfig>;
	function useWorkflowFromContext<R>(
		selector: (workflow: Workflow<TConfig>) => R,
		equalityFn?: (a: R, b: R) => boolean,
	): R;
	function useWorkflowFromContext<R>(
		selector?: (workflow: Workflow<TConfig>) => R,
		equalityFn?: (a: R, b: R) => boolean,
	): UseWorkflowReturn<TConfig> | R {
		const store = useContext(StoreContext);
		if (!store) {
			throw new Error(
				"useWorkflow must be used within a WorkflowProvider. " +
					"Wrap your component tree with <Provider store={...}>.",
			);
		}
		if (selector) {
			// biome-ignore lint/correctness/useHookAtTopLevel: selector presence is stable per render — callers must not change between selector and no-selector mode
			return useWorkflow(store, selector, equalityFn);
		}
		// biome-ignore lint/correctness/useHookAtTopLevel: called on the non-selector path; mutually exclusive with the branch above but stable per component lifetime
		return useWorkflow(store);
	}

	return { Provider, useWorkflow: useWorkflowFromContext };
}
