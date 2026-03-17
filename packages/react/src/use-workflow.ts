import type { Workflow, WorkflowConfig } from "@rytejs/core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { UseWorkflowReturn, WorkflowStore, WorkflowStoreSnapshot } from "./types.js";

function createReturn<TConfig extends WorkflowConfig>(
	snapshot: WorkflowStoreSnapshot<TConfig>,
	dispatch: WorkflowStore<TConfig>["dispatch"],
): UseWorkflowReturn<TConfig> {
	return {
		workflow: snapshot.workflow,
		state: snapshot.workflow.state,
		data: snapshot.workflow.data,
		isDispatching: snapshot.isDispatching,
		error: snapshot.error,
		dispatch,
		// biome-ignore lint/suspicious/noExplicitAny: match overloads handled by UseWorkflowReturn type
		match(matchers: Record<string, any>, fallback?: (workflow: Workflow<TConfig>) => any): any {
			const state = snapshot.workflow.state as string;
			const matcher = matchers[state];
			if (matcher) {
				return matcher(snapshot.workflow.data, snapshot.workflow);
			}
			if (fallback) {
				return fallback(snapshot.workflow);
			}
			throw new Error(`No match for state "${state}" and no fallback provided`);
		},
	} as UseWorkflowReturn<TConfig>;
}

export function useWorkflow<TConfig extends WorkflowConfig>(
	store: WorkflowStore<TConfig>,
): UseWorkflowReturn<TConfig>;
export function useWorkflow<TConfig extends WorkflowConfig, R>(
	store: WorkflowStore<TConfig>,
	selector: (workflow: Workflow<TConfig>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): R;
export function useWorkflow<TConfig extends WorkflowConfig, R>(
	store: WorkflowStore<TConfig>,
	selector?: (workflow: Workflow<TConfig>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): UseWorkflowReturn<TConfig> | R {
	// Refs for selector caching — always allocated to maintain hook call order
	const selectorRef = useRef(selector);
	const equalityFnRef = useRef(equalityFn);
	const cachedRef = useRef<R | undefined>(undefined);
	const hasCachedRef = useRef(false);
	selectorRef.current = selector;
	equalityFnRef.current = equalityFn;

	const selectorSnapshot = useCallback(() => {
		// biome-ignore lint/style/noNonNullAssertion: selectorSnapshot is only used when selector is defined (checked at call site)
		const next = selectorRef.current!(store.getWorkflow());
		const eq = equalityFnRef.current ?? Object.is;
		if (hasCachedRef.current && eq(cachedRef.current as R, next)) {
			return cachedRef.current;
		}
		cachedRef.current = next;
		hasCachedRef.current = true;
		return next;
	}, [store]);

	const getSnapshot = selector ? selectorSnapshot : store.getSnapshot;

	// biome-ignore lint/suspicious/noExplicitAny: return type varies by overload (snapshot vs selected value)
	const result: any = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);

	if (!selector) {
		return createReturn(result as WorkflowStoreSnapshot<TConfig>, store.dispatch);
	}
	return result as R;
}
