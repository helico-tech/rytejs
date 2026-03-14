import type { ZodType, z } from "zod";
import type { WorkflowSnapshot } from "./snapshot.js";
import type { StateNames, Workflow, WorkflowConfig, WorkflowOf } from "./types.js";
import { ValidationError } from "./types.js";

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
	snapshot(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	restore(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError };
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

		snapshot(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig> {
			return {
				id: workflow.id,
				definitionName: name,
				state: workflow.state,
				data: workflow.data,
				createdAt: workflow.createdAt.toISOString(),
				updatedAt: workflow.updatedAt.toISOString(),
				modelVersion: config.modelVersion ?? 1,
			} as WorkflowSnapshot<TConfig>;
		},

		restore(
			snap: WorkflowSnapshot<TConfig>,
		): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError } {
			const stateSchema = config.states[snap.state as string];
			if (!stateSchema) {
				return {
					ok: false,
					error: new ValidationError("restore", [
						{
							code: "custom",
							message: `Unknown state: ${snap.state}`,
							input: snap.state,
							path: ["state"],
						},
					]),
				};
			}

			const result = stateSchema.safeParse(snap.data);
			if (!result.success) {
				return {
					ok: false,
					error: new ValidationError("restore", result.error.issues),
				};
			}

			return {
				ok: true,
				workflow: {
					id: snap.id,
					definitionName: snap.definitionName,
					state: snap.state,
					data: result.data,
					createdAt: new Date(snap.createdAt),
					updatedAt: new Date(snap.updatedAt),
				} as Workflow<TConfig>,
			};
		},
	};
}
