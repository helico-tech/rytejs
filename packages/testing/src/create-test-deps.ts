/**
 * Creates a test dependencies object from a partial.
 * Returns the partial cast to the full type — does not proxy or throw on un-stubbed access.
 * Provide only the dependencies your test needs.
 *
 * @param partial - Partial dependencies object with only the methods/properties your test requires
 * @returns The partial cast to the full dependency type
 */
export function createTestDeps<T>(partial: Partial<T>): T {
	return partial as T;
}
