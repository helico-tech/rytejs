/**
 * Creates a test dependencies object from a partial.
 * Returns the partial cast to the full type — does not proxy or throw on un-stubbed access.
 * Provide only the dependencies your test needs.
 */
export function createTestDeps<T>(partial: Partial<T>): T {
	return partial as T;
}
