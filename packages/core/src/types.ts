import type { ZodType, z } from "zod";

/**
 * Shape of the configuration object passed to {@link defineWorkflow}.
 */
export interface WorkflowConfig {
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

export type StateNames<T extends WorkflowConfig> = keyof T["states"] & string;
export type CommandNames<T extends WorkflowConfig> = keyof T["commands"] & string;
export type EventNames<T extends WorkflowConfig> = keyof T["events"] & string;
export type ErrorCodes<T extends WorkflowConfig> = keyof T["errors"] & string;

/** Infers the data type for a given state. */
export type StateData<
	T extends WorkflowConfig,
	S extends StateNames<T>,
> = T["states"][S] extends ZodType ? z.infer<T["states"][S]> : never;

/** Infers the payload type for a given command. */
export type CommandPayload<
	T extends WorkflowConfig,
	C extends CommandNames<T>,
> = T["commands"][C] extends ZodType ? z.infer<T["commands"][C]> : never;

/** Infers the data type for a given event. */
export type EventData<
	T extends WorkflowConfig,
	E extends EventNames<T>,
> = T["events"][E] extends ZodType ? z.infer<T["events"][E]> : never;

/** Infers the data type for a given error code. */
export type ErrorData<
	T extends WorkflowConfig,
	C extends ErrorCodes<T>,
> = T["errors"][C] extends ZodType ? z.infer<T["errors"][C]> : never;

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
