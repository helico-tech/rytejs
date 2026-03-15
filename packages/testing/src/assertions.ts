import type { DispatchResult, WorkflowConfig } from "@rytejs/core";

/**
 * Asserts that a dispatch result is ok. Optionally checks the resulting state.
 * Throws on failure — works with any test runner.
 *
 * @param result - The dispatch result to assert on
 * @param expectedState - If provided, also asserts the workflow is in this state
 */
export function expectOk<TConfig extends WorkflowConfig>(
	result: DispatchResult<TConfig>,
	expectedState?: string,
): asserts result is Extract<DispatchResult<TConfig>, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected ok result, but got error: ${JSON.stringify(result.error)}`);
	}
	if (expectedState !== undefined && result.workflow.state !== expectedState) {
		throw new Error(`Expected state '${expectedState}' but got '${result.workflow.state}'`);
	}
}

/**
 * Asserts that a dispatch result is an error with the given category.
 * Optionally checks the error code (for domain/router errors).
 * Throws on failure — works with any test runner.
 *
 * @param result - The dispatch result to assert on
 * @param category - Expected error category
 * @param code - If provided, also asserts the error code matches (for `"domain"` and `"router"` categories)
 */
export function expectError<TConfig extends WorkflowConfig>(
	result: DispatchResult<TConfig>,
	category: "validation" | "domain" | "router",
	code?: string,
): asserts result is Extract<DispatchResult<TConfig>, { ok: false }> {
	if (result.ok) {
		throw new Error(`Expected error result, but got ok with state '${result.workflow.state}'`);
	}
	if (result.error.category !== category) {
		throw new Error(`Expected error category '${category}' but got '${result.error.category}'`);
	}
	if (code !== undefined && "code" in result.error && result.error.code !== code) {
		throw new Error(`Expected error code '${code}' but got '${result.error.code}'`);
	}
}
