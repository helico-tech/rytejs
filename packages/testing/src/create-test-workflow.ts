import type {
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
} from "@rytejs/core";

/** Options for createTestWorkflow. */
export interface CreateTestWorkflowOptions {
	/** Custom workflow ID. Defaults to "test-<random>". */
	id?: string;
}

/**
 * Creates a workflow in any state without dispatching through the handler chain.
 * Validates data against the state's Zod schema.
 */
export function createTestWorkflow<TConfig extends WorkflowConfig, S extends StateNames<TConfig>>(
	definition: WorkflowDefinition<TConfig>,
	state: S,
	data: StateData<TConfig, S>,
	options?: CreateTestWorkflowOptions,
): Workflow<TConfig> {
	const id = options?.id ?? `test-${Math.random().toString(36).slice(2, 9)}`;
	return definition.createWorkflow(id, { initialState: state, data }) as Workflow<TConfig>;
}
