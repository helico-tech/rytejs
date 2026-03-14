import type {
	CommandNames,
	CommandPayload,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
	WorkflowRouter,
} from "@rytejs/core";

/** A single step in a transition path test. */
export interface PathStep<TConfig extends WorkflowConfig> {
	/** Starting state — required on the first step, ignored on subsequent steps. */
	start?: StateNames<TConfig>;
	/** Initial data for the starting state — required on the first step. */
	data?: StateData<TConfig, StateNames<TConfig>>;
	/** Command to dispatch. */
	command: CommandNames<TConfig>;
	/** Command payload. */
	payload: CommandPayload<TConfig, CommandNames<TConfig>>;
	/** Expected state after dispatch. */
	expect: StateNames<TConfig>;
}

/**
 * Tests a sequence of commands and verifies the expected state after each dispatch.
 * Creates the initial workflow from the first step's start/data, then chains dispatch results.
 * Throws on failure — works with any test runner.
 */
export async function testPath<TConfig extends WorkflowConfig, TDeps>(
	router: WorkflowRouter<TConfig, TDeps>,
	definition: WorkflowDefinition<TConfig>,
	steps: PathStep<TConfig>[],
): Promise<void> {
	if (steps.length === 0) throw new Error("testPath requires at least one step");
	const first = steps[0];
	if (first === undefined) throw new Error("testPath requires at least one step");
	if (!first.start) throw new Error("First step must have a 'start' state");

	let workflow: Workflow<TConfig> = definition.createWorkflow(
		`test-${Math.random().toString(36).slice(2, 9)}`,
		{ initialState: first.start, data: first.data as any },
	) as Workflow<TConfig>;

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step === undefined) continue;

		const result = await router.dispatch(workflow, {
			type: step.command,
			payload: step.payload,
		});

		if (!result.ok) {
			throw new Error(
				`Step ${i + 1}: dispatch '${step.command}' failed: ${JSON.stringify(result.error)}`,
			);
		}

		if (result.workflow.state !== step.expect) {
			throw new Error(
				`Step ${i + 1}: Expected state '${step.expect}' but got '${result.workflow.state}'`,
			);
		}

		workflow = result.workflow;
	}
}
