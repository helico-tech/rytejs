import type { WorkflowSnapshot } from "./snapshot.js";
import type { StandardSchemaV1 } from "./standard.js";
import { validateSchema } from "./standard.js";
import type { StateSchema, StateServerKeys } from "./state.js";
import { resolveSchema, resolveServerKeys } from "./state.js";
import type {
	ClientWorkflow,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowConfigInput,
	WorkflowOf,
} from "./types.js";
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
		config: { initialState: S; data: StateData<TConfig, S> },
	): WorkflowOf<TConfig, S>;
	/**
	 * Returns the Zod schema for a given state name.
	 *
	 * @param stateName - The state name to look up
	 * @throws If the state name is not found in the config
	 */
	getStateSchema(stateName: string): StandardSchemaV1;
	/**
	 * Returns the schema for a given command name.
	 *
	 * @param commandName - The command name to look up
	 * @throws If the command name is not found in the config
	 */
	getCommandSchema(commandName: string): StandardSchemaV1;
	/**
	 * Returns the schema for a given event name.
	 *
	 * @param eventName - The event name to look up
	 * @throws If the event name is not found in the config
	 */
	getEventSchema(eventName: string): StandardSchemaV1;
	/**
	 * Returns the schema for a given error code.
	 *
	 * @param errorCode - The error code to look up
	 * @throws If the error code is not found in the config
	 */
	getErrorSchema(errorCode: string): StandardSchemaV1;
	/**
	 * Returns `true` if the given state name exists in the config.
	 *
	 * @param stateName - The state name to check
	 */
	hasState(stateName: string): boolean;
	/**
	 * Returns `true` if the given command name exists in the config.
	 */
	hasCommand(commandName: string): boolean;
	/**
	 * Returns `true` if the given event name exists in the config.
	 */
	hasEvent(eventName: string): boolean;
	/**
	 * Serializes a workflow instance into a plain, JSON-safe snapshot.
	 *
	 * @param workflow - The workflow instance to serialize
	 * @returns A {@link WorkflowSnapshot} representing the current state
	 */
	serialize(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	/**
	 * Deserializes a workflow instance from a plain snapshot, validating the state data.
	 *
	 * @param snapshot - The snapshot to deserialize from
	 * @returns A result object: `{ ok: true, workflow }` or `{ ok: false, error }`
	 */
	deserialize(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError };
	/**
	 * Serializes a workflow into a client-safe snapshot with server-only fields stripped.
	 *
	 * @param workflow - The workflow instance to serialize
	 * @returns A {@link WorkflowSnapshot} with server-only fields removed from `data`
	 */
	serializeForClient(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	/**
	 * Returns a client-safe projection of this definition.
	 * Memoized — returns the same instance on repeated calls.
	 */
	forClient(): ClientWorkflowDefinition<TConfig>;
}

/**
 * A client-safe projection of a workflow definition.
 * Server-declared fields are stripped by `serializeForClient()`; this projection
 * deserialises snapshots without re-validation (snapshots come from a trusted
 * server and should not be mutated in transit). Consumers wanting
 * defence-in-depth should validate manually before calling `deserialize`.
 */
export interface ClientWorkflowDefinition<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** The raw schema configuration. */
	readonly config: TConfig;
	readonly name: string;
	hasState(stateName: string): boolean;
	deserialize(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: ClientWorkflow<TConfig> } | { ok: false; error: ValidationError };
}

/**
 * Creates a workflow definition from a name and Zod schema configuration.
 *
 * @param name - Unique name for this workflow type
 * @param config - Object with `states`, `commands`, `events`, `errors` — each a record of Zod schemas
 * @returns A {@link WorkflowDefinition} with methods for creating instances and accessing schemas
 */
// Type inference flows through Standard Schema's `~standard.types.output`
// rather than validator-specific helpers (z.infer, Valibot InferOutput, etc.).
// A state entry can be either a plain schema or a `state({ schema, server })`
// config — the `StateSchema` helper normalises both forms.
/** Extracts the inferred output type of a schema, structural and non-recursive. */
type InferOut<T> = T extends {
	readonly "~standard": { readonly types?: { readonly output: infer O } | undefined };
}
	? O
	: unknown;

/** Full inferred data for a state entry (schema or config). */
type StateFullData<E> = InferOut<StateSchema<E>>;
/** Client-safe inferred data — server keys removed. */
type StateClientData<E> = Omit<StateFullData<E>, StateServerKeys<E>>;

export function defineWorkflow<const TConfig extends WorkflowConfigInput>(
	name: string,
	config: TConfig,
): WorkflowDefinition<{
	modelVersion: TConfig["modelVersion"] extends number ? TConfig["modelVersion"] : 1;
	states: { [K in keyof TConfig["states"]]: StateFullData<TConfig["states"][K]> };
	commands: { [K in keyof TConfig["commands"]]: InferOut<TConfig["commands"][K]> };
	events: { [K in keyof TConfig["events"]]: InferOut<TConfig["events"][K]> };
	errors: { [K in keyof TConfig["errors"]]: InferOut<TConfig["errors"][K]> };
	clientStates: { [K in keyof TConfig["states"]]: StateClientData<TConfig["states"][K]> };
}>;
// biome-ignore lint/suspicious/noExplicitAny: implementation overload — public signature above provides consumer-facing type safety
export function defineWorkflow(name: string, config: WorkflowConfigInput): WorkflowDefinition<any> {
	// biome-ignore lint/suspicious/noExplicitAny: memoized client definition — typed via public interface ClientWorkflowDefinition
	let cachedClientDef: any = null;

	return {
		config,
		name,

		createWorkflow(id: string, wfConfig: { initialState: string; data: unknown }) {
			const entry = config.states[wfConfig.initialState];
			if (!entry) throw new Error(`Unknown state: ${wfConfig.initialState}`);
			const result = validateSchema(resolveSchema(entry), wfConfig.data);
			if (!result.ok) {
				throw new Error(
					`Invalid initial data for state '${wfConfig.initialState}': ${result.issues.map((i) => i.message).join(", ")}`,
				);
			}
			const now = new Date();
			return {
				id,
				definitionName: name,
				state: wfConfig.initialState,
				data: result.value,
				createdAt: now,
				updatedAt: now,
				// biome-ignore lint/suspicious/noExplicitAny: narrowed by the public overload's generic S parameter
			} as any;
		},

		getStateSchema(stateName: string): StandardSchemaV1 {
			const entry = config.states[stateName];
			if (!entry) throw new Error(`Unknown state: ${stateName}`);
			return resolveSchema(entry);
		},

		getCommandSchema(commandName: string): StandardSchemaV1 {
			const schema = config.commands[commandName];
			if (!schema) throw new Error(`Unknown command: ${commandName}`);
			return schema as StandardSchemaV1;
		},

		getEventSchema(eventName: string): StandardSchemaV1 {
			const schema = config.events[eventName];
			if (!schema) throw new Error(`Unknown event: ${eventName}`);
			return schema as StandardSchemaV1;
		},

		getErrorSchema(errorCode: string): StandardSchemaV1 {
			const schema = config.errors[errorCode];
			if (!schema) throw new Error(`Unknown error: ${errorCode}`);
			return schema as StandardSchemaV1;
		},

		hasState(stateName: string): boolean {
			return stateName in config.states;
		},

		hasCommand(commandName: string): boolean {
			return commandName in config.commands;
		},

		hasEvent(eventName: string): boolean {
			return eventName in config.events;
		},

		serialize(workflow: {
			id: string;
			state: string;
			data: unknown;
			createdAt: Date;
			updatedAt: Date;
			version?: number;
		}) {
			return {
				id: workflow.id,
				definitionName: name,
				state: workflow.state,
				data: workflow.data,
				createdAt: workflow.createdAt.toISOString(),
				updatedAt: workflow.updatedAt.toISOString(),
				modelVersion: config.modelVersion ?? 1,
				version: workflow.version ?? 1,
			};
		},

		deserialize(snap: {
			id: string;
			definitionName: string;
			state: string;
			data: unknown;
			createdAt: string;
			updatedAt: string;
		}) {
			const entry = config.states[snap.state];
			if (!entry) {
				return {
					ok: false,
					error: new ValidationError("restore", [
						{ message: `Unknown state: ${snap.state}`, path: ["state"] },
					]),
				};
			}

			const result = validateSchema(resolveSchema(entry), snap.data);
			if (!result.ok) {
				return {
					ok: false,
					error: new ValidationError("restore", result.issues),
				};
			}

			return {
				ok: true,
				workflow: {
					id: snap.id,
					definitionName: snap.definitionName,
					state: snap.state,
					data: result.value,
					createdAt: new Date(snap.createdAt),
					updatedAt: new Date(snap.updatedAt),
				},
				// biome-ignore lint/suspicious/noExplicitAny: runtime narrow to Workflow<TConfig>; unknown data needs cast
			} as any;
		},

		serializeForClient(workflow: {
			id: string;
			state: string;
			data: unknown;
			createdAt: Date;
			updatedAt: Date;
			version?: number;
		}) {
			const entry = config.states[workflow.state];
			const serverKeys = entry ? resolveServerKeys(entry) : [];
			let strippedData: unknown = workflow.data;
			if (serverKeys.length > 0 && workflow.data && typeof workflow.data === "object") {
				const copy: Record<string, unknown> = { ...(workflow.data as Record<string, unknown>) };
				for (const key of serverKeys) delete copy[key];
				strippedData = copy;
			}

			return {
				id: workflow.id,
				definitionName: name,
				state: workflow.state,
				data: strippedData,
				createdAt: workflow.createdAt.toISOString(),
				updatedAt: workflow.updatedAt.toISOString(),
				modelVersion: config.modelVersion ?? 1,
				version: workflow.version ?? 1,
			};
		},

		forClient() {
			if (cachedClientDef) return cachedClientDef;

			cachedClientDef = {
				config,
				name,

				hasState(stateName: string): boolean {
					return stateName in config.states;
				},

				deserialize(snap: {
					id: string;
					definitionName: string;
					state: string;
					data: unknown;
					createdAt: string;
					updatedAt: string;
				}) {
					if (!(snap.state in config.states)) {
						return {
							ok: false,
							error: new ValidationError("restore", [
								{ message: `Unknown state: ${snap.state}`, path: ["state"] },
							]),
						};
					}
					// No schema re-validation on the client side — snapshots are
					// produced by a trusted server (already validated + stripped).
					// Users who want defence-in-depth should validate separately
					// against their own client schema before calling deserialize.
					return {
						ok: true,
						workflow: {
							id: snap.id,
							definitionName: snap.definitionName,
							state: snap.state,
							data: snap.data,
							createdAt: new Date(snap.createdAt),
							updatedAt: new Date(snap.updatedAt),
							// biome-ignore lint/suspicious/noExplicitAny: runtime narrow to ClientWorkflow<TConfig>
						} as any,
					};
				},
			};

			return cachedClientDef;
		},
	};
}
