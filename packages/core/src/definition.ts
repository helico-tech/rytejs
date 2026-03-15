import type { ZodType, z } from "zod";
import type { WorkflowSnapshot } from "./snapshot.js";
import type { StateNames, Workflow, WorkflowConfig, WorkflowOf } from "./types.js";
import { ValidationError } from "./types.js";

/**
 * The result of {@link defineWorkflow} — holds schemas and creates workflow instances.
 */
export interface WorkflowDefinition<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** The raw Zod schema configuration. */
	readonly config: TConfig;
	/** The workflow definition name. */
	readonly name: string;
	/**
	 * Creates a new workflow instance in a given initial state.
	 *
	 * @param id - Unique identifier for this workflow instance
	 * @param config - Object containing `initialState` and the corresponding `data`
	 * @returns A {@link WorkflowOf} narrowed to the initial state
	 */
	createWorkflow<S extends StateNames<TConfig>>(
		id: string,
		config: { initialState: S; data: z.infer<TConfig["states"][S]> },
	): WorkflowOf<TConfig, S>;
	/**
	 * Returns the Zod schema for a given state name.
	 *
	 * @param stateName - The state name to look up
	 * @throws If the state name is not found in the config
	 */
	getStateSchema(stateName: string): ZodType;
	/**
	 * Returns the Zod schema for a given command name.
	 *
	 * @param commandName - The command name to look up
	 * @throws If the command name is not found in the config
	 */
	getCommandSchema(commandName: string): ZodType;
	/**
	 * Returns the Zod schema for a given event name.
	 *
	 * @param eventName - The event name to look up
	 * @throws If the event name is not found in the config
	 */
	getEventSchema(eventName: string): ZodType;
	/**
	 * Returns the Zod schema for a given error code.
	 *
	 * @param errorCode - The error code to look up
	 * @throws If the error code is not found in the config
	 */
	getErrorSchema(errorCode: string): ZodType;
	/**
	 * Returns `true` if the given state name exists in the config.
	 *
	 * @param stateName - The state name to check
	 */
	hasState(stateName: string): boolean;
	/**
	 * Serializes a workflow instance into a plain, JSON-safe snapshot.
	 *
	 * @param workflow - The workflow instance to serialize
	 * @returns A {@link WorkflowSnapshot} representing the current state
	 */
	snapshot(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	/**
	 * Restores a workflow instance from a plain snapshot, validating the state data.
	 *
	 * @param snapshot - The snapshot to restore from
	 * @returns A result object: `{ ok: true, workflow }` or `{ ok: false, error }`
	 */
	restore(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError };
}

/**
 * Creates a workflow definition from a name and Zod schema configuration.
 *
 * @param name - Unique name for this workflow type
 * @param config - Object with `states`, `commands`, `events`, `errors` — each a record of Zod schemas
 * @returns A {@link WorkflowDefinition} with methods for creating instances and accessing schemas
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
