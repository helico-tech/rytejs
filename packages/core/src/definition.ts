import type { ZodType, z } from "zod";
import type { StateNames, WorkflowConfig, WorkflowOf } from "./types.js";

/** The result of defineWorkflow() — holds schemas and creates workflow instances. */
export interface WorkflowDefinition<TConfig extends WorkflowConfig = WorkflowConfig> {
	readonly config: TConfig;
	readonly name: string;
	createWorkflow<S extends StateNames<TConfig>>(
		id: string,
		config: { initialState: S; data: z.infer<TConfig["states"][S]> },
	): WorkflowOf<TConfig, S>;
	getStateSchema(stateName: string): ZodType;
	getCommandSchema(commandName: string): ZodType;
	getEventSchema(eventName: string): ZodType;
	getErrorSchema(errorCode: string): ZodType;
	hasState(stateName: string): boolean;
}

/**
 * Creates a workflow definition from a name and Zod schema configuration.
 */
export function defineWorkflow<const TConfig extends WorkflowConfig>(
	name: string,
	config: TConfig,
): WorkflowDefinition<TConfig> {
	return {
		config,
		name,

		createWorkflow(id, wfConfig) {
			const schema = config.states[wfConfig.initialState as string];
			if (!schema) throw new Error(`Unknown state: ${wfConfig.initialState as string}`);
			const result = schema.safeParse(wfConfig.data);
			if (!result.success) {
				throw new Error(
					`Invalid initial data for state '${wfConfig.initialState as string}': ${result.error.issues.map((i) => i.message).join(", ")}`,
				);
			}
			const now = new Date();
			return {
				id,
				definitionName: name,
				state: wfConfig.initialState,
				data: result.data,
				createdAt: now,
				updatedAt: now,
			} as WorkflowOf<TConfig, typeof wfConfig.initialState>;
		},

		getStateSchema(stateName: string): ZodType {
			const schema = config.states[stateName];
			if (!schema) throw new Error(`Unknown state: ${stateName}`);
			return schema;
		},

		getCommandSchema(commandName: string): ZodType {
			const schema = config.commands[commandName];
			if (!schema) throw new Error(`Unknown command: ${commandName}`);
			return schema;
		},

		getEventSchema(eventName: string): ZodType {
			const schema = config.events[eventName];
			if (!schema) throw new Error(`Unknown event: ${eventName}`);
			return schema;
		},

		getErrorSchema(errorCode: string): ZodType {
			const schema = config.errors[errorCode];
			if (!schema) throw new Error(`Unknown error: ${errorCode}`);
			return schema;
		},

		hasState(stateName: string): boolean {
			return stateName in config.states;
		},
	};
}
