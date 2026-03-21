import type { Workflow, WorkflowConfig } from "@rytejs/core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { UseWorkflowReturn, WorkflowStore, WorkflowStoreSnapshot } from "./types.js";

function createReturn<TConfig extends WorkflowConfig>(
	snapshot: WorkflowStoreSnapshot<TConfig>,
	dispatch: WorkflowStore<TConfig>["dispatch"],
): UseWorkflowReturn<TConfig> {
	const wf = snapshot.workflow;
	return {
		workflow: wf,
		// biome-ignore lint/suspicious/noExplicitAny: state/data are undefined when workflow is null (loading) — consumers check isLoading first
		state: wf?.state as any,
		// biome-ignore lint/suspicious/noExplicitAny: see above
		data: wf?.data as any,
		isLoading: snapshot.isLoading,
		isDispatching: snapshot.isDispatching,
		error: snapshot.error,
		dispatch,
		// biome-ignore lint/suspicious/noExplicitAny: match overloads handled by UseWorkflowReturn type
		match(
			matchers: Record<string, any>,
			fallback?: (workflow: Workflow<TConfig> | null) => any,
		): any {
			if (!wf) {
				if (fallback) return fallback(wf);
				throw new Error("Cannot match on a loading workflow — check isLoading first");
			}
			const state = wf.state as string;
			const matcher = matchers[state];
			if (matcher) {
				return matcher(wf.data, wf);
			}
			if (fallback) {
				return fallback(wf);
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
		const wf = store.getWorkflow();
		if (!wf) {
			// Workflow is loading — return cached value if available
			return cachedRef.current;
		}
		// biome-ignore lint/style/noNonNullAssertion: selectorSnapshot is only used when selector is defined (checked at call site)
		const next = selectorRef.current!(wf);
		const eq = equalityFnRef.current ?? Object.is;
		if (hasCachedRef.current && eq(cachedRef.current as R, next)) {
			return cachedRef.current;
		}
		cachedRef.current = next;
		hasCachedRef.current = true;
		return next;
	}, [store]);

	// biome-ignore lint/suspicious/noExplicitAny: return type varies by overload; TS can't narrow union of getSnapshot functions
	const getSnapshot: () => any = selector ? selectorSnapshot : store.getSnapshot;

	const result: unknown = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);

	if (!selector) {
		return createReturn(result as WorkflowStoreSnapshot<TConfig>, store.dispatch);
	}
	return result as R;
}
