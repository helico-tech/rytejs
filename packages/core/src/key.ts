/** A phantom-typed key for type-safe middleware state storage via {@link Context.set} and {@link Context.get}. */
export interface ContextKey<T> {
	/** @internal Phantom type brand — not used at runtime. */
	readonly _phantom: T;
	/** Internal symbol providing uniqueness. */
	readonly id: symbol;
}

/**
 * Creates a unique typed key for storing and retrieving values in context.
 *
 * @param name - Debug label (uniqueness comes from an internal `Symbol`)
 * @returns A {@link ContextKey} for use with `ctx.set()`, `ctx.get()`, and `ctx.getOrNull()`
 */
export function createKey<T>(name: string): ContextKey<T> {
	return { id: Symbol(name) } as ContextKey<T>;
}
