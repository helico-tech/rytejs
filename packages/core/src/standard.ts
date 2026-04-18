/**
 * Inlined Standard Schema V1 spec (https://github.com/standard-schema/standard-schema).
 * Kept internal to rytejs — we do not re-export from index.ts, since consumers
 * interact with their schemas directly (Zod, Valibot, ArkType, etc.).
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
	export interface Props<Input = unknown, Output = Input> {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
		readonly types?: Types<Input, Output> | undefined;
	}
	export interface Types<Input = unknown, Output = Input> {
		readonly input: Input;
		readonly output: Output;
	}
	export type Result<Output> = SuccessResult<Output> | FailureResult;
	export interface SuccessResult<Output> {
		readonly value: Output;
		readonly issues?: undefined;
	}
	export interface FailureResult {
		readonly issues: ReadonlyArray<Issue>;
	}
	export interface Issue {
		readonly message: string;
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}
	export interface PathSegment {
		readonly key: PropertyKey;
	}
	export type InferInput<S extends StandardSchemaV1> = NonNullable<
		S["~standard"]["types"]
	>["input"];
	export type InferOutput<S extends StandardSchemaV1> = NonNullable<
		S["~standard"]["types"]
	>["output"];
}

/**
 * Internal validation result — the shape rytejs threads through router/context/definition.
 */
export type ValidateResult<T> =
	| { ok: true; value: T }
	| { ok: false; issues: readonly StandardSchemaV1.Issue[] };

/**
 * Runs a Standard Schema validator synchronously. Throws on async validators —
 * rytejs handlers are sync at the validation boundary, and supporting async
 * would require making every dispatch/createWorkflow/deserialize return Promise.
 * Async validator support is a future extension; not needed for Zod v4 (sync by default).
 */
export function validateSchema<T>(
	schema: StandardSchemaV1<unknown, T>,
	value: unknown,
): ValidateResult<T> {
	const result = schema["~standard"].validate(value);
	if (result instanceof Promise) {
		throw new Error(
			"rytejs does not support async validators at the dispatch boundary. " +
				"Use a synchronous schema (Zod, Valibot sync, ArkType).",
		);
	}
	if (result.issues) {
		return { ok: false, issues: result.issues };
	}
	return { ok: true, value: result.value };
}
