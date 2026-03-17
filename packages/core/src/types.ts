import type { ZodType, z } from "zod";

/**
 * Shape of the configuration object passed to {@link defineWorkflow}.
 * Exported for internal package use only — not re-exported from index.ts.
 */
export interface WorkflowConfigInput {
	/** Optional version number for schema migrations. Defaults to 1. */
	modelVersion?: number;
	/** Record of state names to Zod schemas defining their data shape. */
	states: Record<string, ZodType>;
	/** Record of command names to Zod schemas defining their payload shape. */
	commands: Record<string, ZodType>;
	/** Record of event names to Zod schemas defining their data shape. */
	events: Record<string, ZodType>;
	/** Record of error codes to Zod schemas defining their data shape. */
	errors: Record<string, ZodType>;
}

/**
 * Workflow configuration with pre-resolved types for IDE completion.
 *
 * Extends {@link WorkflowConfigInput} with a `_resolved` phantom type that
 * caches `z.infer` results. This exists because Zod v4's `z.infer` uses
 * conditional types that TypeScript defers in deep generic chains, breaking
 * IDE autocomplete. The `_resolved` property is never set at runtime — it is
 * populated at the type level by {@link defineWorkflow}'s return type.
 */
export interface WorkflowConfig extends WorkflowConfigInput {
	_resolved: {
		states: Record<string, unknown>;
		commands: Record<string, unknown>;
		events: Record<string, unknown>;
		errors: Record<string, unknown>;
	};
}

export type StateNames<T extends WorkflowConfig> = keyof T["states"] & string;
export type CommandNames<T extends WorkflowConfig> = keyof T["commands"] & string;
export type EventNames<T extends WorkflowConfig> = keyof T["events"] & string;
export type ErrorCodes<T extends WorkflowConfig> = keyof T["errors"] & string;

/** Forces TypeScript to flatten a type for better IDE autocomplete. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Resolves the data type for a given state from pre-computed types. */
export type StateData<T extends WorkflowConfig, S extends StateNames<T>> = Prettify<
	T["_resolved"]["states"][S]
>;

/** Resolves the payload type for a given command from pre-computed types. */
export type CommandPayload<T extends WorkflowConfig, C extends CommandNames<T>> = Prettify<
	T["_resolved"]["commands"][C]
>;

/** Resolves the data type for a given event from pre-computed types. */
export type EventData<T extends WorkflowConfig, E extends EventNames<T>> = Prettify<
	T["_resolved"]["events"][E]
>;

/** Resolves the data type for a given error code from pre-computed types. */
export type ErrorData<T extends WorkflowConfig, C extends ErrorCodes<T>> = Prettify<
	T["_resolved"]["errors"][C]
>;

/** Workflow narrowed to a specific known state. */
export interface WorkflowOf<TConfig extends WorkflowConfig, S extends StateNames<TConfig>> {
	/** Unique workflow instance identifier. */
	readonly id: string;
	/** Name of the workflow definition this instance belongs to. */
	readonly definitionName: string;
	/** Current state name. */
	readonly state: S;
	/** State data, typed according to the state's Zod schema. */
	readonly data: StateData<TConfig, S>;
	/** Timestamp of workflow creation. */
	readonly createdAt: Date;
	/** Timestamp of last state change. */
	readonly updatedAt: Date;
}

/** Discriminated union of all possible workflow states — checking .state narrows .data. */
export type Workflow<TConfig extends WorkflowConfig = WorkflowConfig> = {
	[S in StateNames<TConfig>]: WorkflowOf<TConfig, S>;
}[StateNames<TConfig>];

/** Discriminated union of all pipeline error types on `category`. */
export type PipelineError<TConfig extends WorkflowConfig = WorkflowConfig> =
	| {
			category: "validation";
			source: "command" | "state" | "event" | "transition" | "restore";
			issues: z.core.$ZodIssue[];
			message: string;
	  }
	| {
			category: "domain";
			code: ErrorCodes<TConfig>;
			data: ErrorData<TConfig, ErrorCodes<TConfig>>;
	  }
	| {
			category: "router";
			code: "NO_HANDLER" | "UNKNOWN_STATE";
			message: string;
	  }
	| {
			category: "unexpected";
			error: unknown;
			message: string;
	  }
	| {
			category: "dependency";
			name: string;
			error: unknown;
			message: string;
	  };

/** Return type of {@link WorkflowRouter.dispatch}. Discriminated union on `ok`. */
export type DispatchResult<TConfig extends WorkflowConfig = WorkflowConfig> =
	| {
			ok: true;
			workflow: Workflow<TConfig>;
			events: Array<{ type: EventNames<TConfig>; data: unknown }>;
	  }
	| {
			ok: false;
			error: PipelineError<TConfig>;
	  };

/**
 * Thrown internally when Zod validation fails during dispatch.
 * Caught by the router and returned as a validation error in {@link DispatchResult}.
 *
 * @param source - Which validation stage failed
 * @param issues - Array of Zod validation issues
 */
export class ValidationError extends Error {
	constructor(
		public readonly source: "command" | "state" | "event" | "transition" | "restore",
		public readonly issues: z.core.$ZodIssue[],
	) {
		super(`Validation failed (${source}): ${issues.map((i) => i.message).join(", ")}`);
		this.name = "ValidationError";
	}
}

/**
 * Thrown internally when a handler calls `ctx.error()`.
 * Caught by the router and returned as a domain error in {@link DispatchResult}.
 *
 * @param code - The error code string
 * @param data - The error data payload
 */
export class DomainErrorSignal extends Error {
	constructor(
		public readonly code: string,
		public readonly data: unknown,
	) {
		super(`Domain error: ${code}`);
		this.name = "DomainErrorSignal";
	}
}

/**
 * Thrown internally when a proxied dependency call fails.
 * Caught by the router and returned as a dependency error in {@link DispatchResult}.
 *
 * @param depName - The top-level dependency key (e.g. "db", "stripe")
 * @param error - The original error thrown by the dependency
 */
/** Extracts the WorkflowConfig type from a WorkflowRouter instance. */
export type ConfigOf<R> = R extends import("./router.js").WorkflowRouter<
	infer C extends WorkflowConfig,
	unknown
>
	? C
	: never;

export class DependencyErrorSignal extends Error {
	constructor(
		public readonly depName: string,
		public readonly error: unknown,
	) {
		const original = error instanceof Error ? error.message : String(error);
		super(`Dependency "${depName}" failed: ${original}`);
		this.name = "DependencyErrorSignal";
	}
}
