import type { StandardSchemaV1 } from "./standard.js";

/**
 * State configuration with an optional list of server-only field keys.
 *
 * Declared keys are stripped from the data by `serializeForClient()` and
 * excluded from the `ClientStateData` TypeScript type. Stripping is a
 * validator-agnostic key filter — no schema introspection involved.
 */
export interface StateConfig<
	TSchema extends StandardSchemaV1 = StandardSchemaV1,
	TServer extends readonly string[] = readonly string[],
> {
	readonly schema: TSchema;
	readonly server?: TServer;
}

/**
 * Declares a state with its schema and optional server-only field keys.
 *
 * @example
 * state({
 *     schema: z.object({ applicantName: z.string(), ssn: z.string() }),
 *     server: ["ssn"],
 * })
 */
export function state<
	TSchema extends StandardSchemaV1,
	const TServer extends readonly (keyof StandardSchemaV1.InferOutput<TSchema> &
		string)[] = readonly [],
>(config: { schema: TSchema; server?: TServer }): StateConfig<TSchema, TServer> {
	return { schema: config.schema, server: config.server };
}

/** Extracts the schema from a state entry (plain schema or `state()` config). */
export type StateSchema<E> = E extends { schema: infer S extends StandardSchemaV1 }
	? S
	: E extends StandardSchemaV1
		? E
		: never;

/** Extracts the declared server keys from a state entry, or `never` if none. */
export type StateServerKeys<E> = E extends { readonly server?: infer K }
	? K extends readonly string[]
		? K[number]
		: never
	: never;

/** Runtime: pulls the schema from a state entry of either form. */
export function resolveSchema(entry: unknown): StandardSchemaV1 {
	if (typeof entry === "object" && entry !== null && "schema" in entry) {
		return (entry as StateConfig).schema;
	}
	return entry as StandardSchemaV1;
}

/** Runtime: pulls the server-key list from a state entry, or empty array. */
export function resolveServerKeys(entry: unknown): readonly string[] {
	if (typeof entry === "object" && entry !== null && "server" in entry) {
		return (entry as StateConfig).server ?? [];
	}
	return [];
}
