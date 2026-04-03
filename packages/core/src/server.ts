import type { ZodType } from "zod";
import { z } from "zod";

const SERVER_BRAND: unique symbol = Symbol("ryte.server");

/** Brands a Zod schema type as server-only at the TypeScript level. */
export type Server<T extends ZodType> = T & { readonly [SERVER_BRAND]: true };

/**
 * Marks a Zod schema as server-only. Fields wrapped in `server()` are stripped
 * from client snapshots and excluded from client TypeScript types.
 */
export function server<T extends ZodType>(schema: T): Server<T> {
	// biome-ignore lint/suspicious/noExplicitAny: attaching runtime brand to Zod schema for server field detection
	(schema as any)[SERVER_BRAND] = true;
	return schema as Server<T>;
}

/** Returns `true` if the schema was wrapped with `server()`. */
export function isServerField(schema: ZodType): boolean {
	// biome-ignore lint/suspicious/noExplicitAny: reading runtime brand from Zod schema
	return (schema as any)[SERVER_BRAND] === true;
}

export { SERVER_BRAND };

/**
 * Strips server-only fields from workflow data based on the state's Zod schema.
 * Recursively processes nested z.object() schemas.
 */
export function stripServerData(
	schema: ZodType,
	data: Record<string, unknown>,
): Record<string, unknown> {
	// biome-ignore lint/suspicious/noExplicitAny: accessing Zod v4 internal _zod.def.shape for schema introspection
	const def = (schema as any)._zod?.def;
	if (def?.type !== "object" || !def.shape) return data;

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(data)) {
		const fieldSchema = def.shape[key] as ZodType | undefined;
		if (fieldSchema && isServerField(fieldSchema)) continue;

		if (
			fieldSchema &&
			// biome-ignore lint/suspicious/noExplicitAny: checking Zod v4 internal def.type for nested object detection
			(fieldSchema as any)._zod?.def?.type === "object" &&
			data[key] !== null &&
			typeof data[key] === "object"
		) {
			result[key] = stripServerData(fieldSchema, data[key] as Record<string, unknown>);
		} else {
			result[key] = data[key];
		}
	}
	return result;
}

/**
 * Derives a client-safe Zod schema by removing server-only fields.
 * Recursively processes nested z.object() schemas.
 * Returns the original schema unchanged for non-object schemas.
 */
export function deriveClientSchema(schema: ZodType): ZodType {
	// biome-ignore lint/suspicious/noExplicitAny: accessing Zod v4 internal _zod.def.shape for schema introspection
	const def = (schema as any)._zod?.def;
	if (def?.type !== "object" || !def.shape) return schema;

	const clientShape: Record<string, ZodType> = {};
	for (const [key, fieldSchema] of Object.entries(def.shape as Record<string, ZodType>)) {
		if (isServerField(fieldSchema)) continue;

		// biome-ignore lint/suspicious/noExplicitAny: checking Zod v4 internal def.type for nested object detection
		if ((fieldSchema as any)._zod?.def?.type === "object") {
			clientShape[key] = deriveClientSchema(fieldSchema);
		} else {
			clientShape[key] = fieldSchema;
		}
	}
	return z.object(clientShape).strict();
}
