import type { ZodType } from "zod";

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
