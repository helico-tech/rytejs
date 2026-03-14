import type { ZodType, z } from "zod";

export interface WorkflowConfig {
	modelVersion?: number;
	states: Record<string, ZodType>;
	commands: Record<string, ZodType>;
	events: Record<string, ZodType>;
	errors: Record<string, ZodType>;
}

export type StateNames<T extends WorkflowConfig> = keyof T["states"] & string;
export type CommandNames<T extends WorkflowConfig> = keyof T["commands"] & string;
export type EventNames<T extends WorkflowConfig> = keyof T["events"] & string;
export type ErrorCodes<T extends WorkflowConfig> = keyof T["errors"] & string;

export type StateData<
	T extends WorkflowConfig,
	S extends StateNames<T>,
> = T["states"][S] extends ZodType ? z.infer<T["states"][S]> : never;

export type CommandPayload<
	T extends WorkflowConfig,
	C extends CommandNames<T>,
> = T["commands"][C] extends ZodType ? z.infer<T["commands"][C]> : never;

export type EventData<
	T extends WorkflowConfig,
	E extends EventNames<T>,
> = T["events"][E] extends ZodType ? z.infer<T["events"][E]> : never;

export type ErrorData<
	T extends WorkflowConfig,
	C extends ErrorCodes<T>,
> = T["errors"][C] extends ZodType ? z.infer<T["errors"][C]> : never;

/** Workflow narrowed to a specific known state. */
export interface WorkflowOf<TConfig extends WorkflowConfig, S extends StateNames<TConfig>> {
	readonly id: string;
	readonly definitionName: string;
	readonly state: S;
	readonly data: StateData<TConfig, S>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** Discriminated union of all possible workflow states — checking .state narrows .data. */
export type Workflow<TConfig extends WorkflowConfig = WorkflowConfig> = {
	[S in StateNames<TConfig>]: WorkflowOf<TConfig, S>;
}[StateNames<TConfig>];

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
	  };

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

/** Thrown internally when Zod validation fails during dispatch. */
export class ValidationError extends Error {
	constructor(
		public readonly source: "command" | "state" | "event" | "transition" | "restore",
		public readonly issues: z.core.$ZodIssue[],
	) {
		super(`Validation failed (${source}): ${issues.map((i) => i.message).join(", ")}`);
		this.name = "ValidationError";
	}
}

/** Thrown internally when a handler calls ctx.error(). Caught by the router. */
export class DomainErrorSignal extends Error {
	constructor(
		public readonly code: string,
		public readonly data: unknown,
	) {
		super(`Domain error: ${code}`);
		this.name = "DomainErrorSignal";
	}
}
