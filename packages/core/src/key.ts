/** A phantom-typed key for type-safe middleware state storage. */
export interface ContextKey<T> {
	readonly _phantom: T;
	readonly id: symbol;
}

/** Creates a unique typed key for storing/retrieving values in context. */
export function createKey<T>(name: string): ContextKey<T> {
	return { id: Symbol(name) } as ContextKey<T>;
}
