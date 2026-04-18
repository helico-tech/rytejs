import type { StandardSchemaV1 } from "./standard.js";

/**
 * Shape of the configuration object passed to {@link defineWorkflow}.
 * Uses `unknown` schema slots so TS doesn't structurally verify each schema
 * against a validator-specific constraint. `defineWorkflow`'s generic pulls
 * the output types via a defensive conditional that matches StandardSchemaV1
 * at the inference site only — without recursively walking Zod's variance chain.
 */
export interface WorkflowConfigInput {
	/** Optional version number for schema migrations. Defaults to 1. */
	modelVersion?: number;
	states: Record<string, unknown>;
	commands: Record<string, unknown>;
	events: Record<string, unknown>;
	errors: Record<string, unknown>;
}

/**
 * Flattened workflow configuration — carries only already-resolved output shapes.
 * No validator library types are threaded through router/context generics.
 */
export interface WorkflowConfig {
	modelVersion?: number;
	states: Record<string, unknown>;
	commands: Record<string, unknown>;
	events: Record<string, unknown>;
	errors: Record<string, unknown>;
	clientStates: Record<string, unknown>;
}

export type StateNames<T extends WorkflowConfig> = keyof T["states"] & string;
export type CommandNames<T extends WorkflowConfig> = keyof T["commands"] & string;
export type EventNames<T extends WorkflowConfig> = keyof T["events"] & string;
export type ErrorCodes<T extends WorkflowConfig> = keyof T["errors"] & string;

/** Discriminated union of all commands with typed payloads — narrows payload when checking type. */
export type Command<T extends WorkflowConfig> = {
	[C in CommandNames<T>]: { type: C; payload: CommandPayload<T, C> };
}[CommandNames<T>];

/** Resolves the data type for a given state from pre-computed types. */
export type StateData<T extends WorkflowConfig, S extends StateNames<T>> = T["states"][S];

/** Resolves the client-safe data type for a given state (server fields stripped). */
export type ClientStateData<
	T extends WorkflowConfig,
	S extends StateNames<T>,
> = T["clientStates"][S];

/** Client-side workflow narrowed to a specific known state. */
export interface ClientWorkflowOf<TConfig extends WorkflowConfig, S extends StateNames<TConfig>> {
	readonly id: string;
	readonly definitionName: string;
	readonly state: S;
	readonly data: ClientStateData<TConfig, S>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** Discriminated union of all possible client-side workflow states. */
export type ClientWorkflow<TConfig extends WorkflowConfig = WorkflowConfig> = {
	[S in StateNames<TConfig>]: ClientWorkflowOf<TConfig, S>;
}[StateNames<TConfig>];

/** Resolves the payload type for a given command from pre-computed types. */
export type CommandPayload<T extends WorkflowConfig, C extends CommandNames<T>> = T["commands"][C];

/** Resolves the data type for a given event from pre-computed types. */
export type EventData<T extends WorkflowConfig, E extends EventNames<T>> = T["events"][E];

/** Resolves the data type for a given error code from pre-computed types. */
export type ErrorData<T extends WorkflowConfig, C extends ErrorCodes<T>> = T["errors"][C];

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
			issues: readonly StandardSchemaV1.Issue[];
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
 * Thrown internally when schema validation fails during dispatch.
 * Caught by the router and returned as a validation error in {@link DispatchResult}.
 *
 * @param source - Which validation stage failed
 * @param issues - Validator-agnostic issue array (Standard Schema shape)
 */
export class ValidationError extends Error {
	constructor(
		public readonly source: "command" | "state" | "event" | "transition" | "restore",
		public readonly issues: readonly StandardSchemaV1.Issue[],
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
export type ConfigOf<R> = R extends { definition: { config: infer C } } ? C : never;

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
