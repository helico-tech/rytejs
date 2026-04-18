import type { StandardSchemaV1 } from "./standard.js";

/**
 * State configuration — a server-side schema plus an optional client-side schema.
 *
 * When `clientSchema` is provided, `serializeForClient()` runs data through it and
 * returns the validator's stripped result (Zod / Valibot default-strip; ArkType
 * users should use loose `type({...})`). `ClientStateData<TConfig, S>` is typed
 * as the `clientSchema`'s inferred output — fields absent from `clientSchema` are
 * not visible to client TypeScript code.
 *
 * If `clientSchema` is omitted, server and client share the same shape and no
 * stripping happens at serialization time.
 */
export interface StateConfig<
	TSchema extends StandardSchemaV1 = StandardSchemaV1,
	TClientSchema extends StandardSchemaV1 = TSchema,
> {
	readonly schema: TSchema;
	readonly clientSchema?: TClientSchema;
}

/**
 * Declares a state with a primary (server-side) schema and an optional
 * client-side schema. Keeping schemas as the unit of declaration makes the
 * API validator-agnostic — we never inspect schema shape.
 *
 * @example
 * state({
 *     schema: z.object({ applicantName: z.string(), ssn: z.string() }),
 *     clientSchema: z.object({ applicantName: z.string() }),
 * })
 */
export function state<
	TSchema extends StandardSchemaV1,
	TClientSchema extends StandardSchemaV1 = TSchema,
>(config: { schema: TSchema; clientSchema?: TClientSchema }): StateConfig<TSchema, TClientSchema> {
	return { schema: config.schema, clientSchema: config.clientSchema };
}

/** Extracts the server-side schema from a state entry (plain schema or `state()` config). */
export type StateSchema<E> = E extends { schema: infer S extends StandardSchemaV1 }
	? S
	: E extends StandardSchemaV1
		? E
		: never;

/**
 * Extracts the client-side schema from a state entry:
 * - `state({ schema, clientSchema })` → `clientSchema`
 * - `state({ schema })` (no clientSchema) → `schema`
 * - plain schema → itself
 */
export type StateClientSchema<E> = E extends {
	readonly clientSchema?: infer C;
}
	? C extends StandardSchemaV1
		? C
		: StateSchema<E>
	: StateSchema<E>;

/** Runtime: pulls the server-side schema from a state entry of either form. */
export function resolveSchema(entry: unknown): StandardSchemaV1 {
	if (typeof entry === "object" && entry !== null && "schema" in entry) {
		return (entry as StateConfig).schema;
	}
	return entry as StandardSchemaV1;
}

/** Runtime: pulls the client-side schema if the entry declares one; otherwise `undefined`. */
export function resolveClientSchema(entry: unknown): StandardSchemaV1 | undefined {
	if (typeof entry === "object" && entry !== null && "clientSchema" in entry) {
		const cs = (entry as StateConfig).clientSchema;
		return cs;
	}
	return undefined;
}
