import type { CommandNames } from "@rytejs/core";
import { WorkflowRouter } from "@rytejs/core";
import { taskWorkflow } from "../fixtures.js";

type TaskCommand = { type: CommandNames<typeof taskWorkflow.config>; payload: unknown };

declare const store: {
	get(id: string): Promise<unknown>;
	set(id: string, data: unknown): Promise<void>;
};
declare function parseInput(req: unknown): { workflowId: string; command: TaskCommand };
declare const request: unknown;

// ── #pattern ──────────────────────────────────────────────────────────────────

// #region pattern
(async () => {
	const definition = taskWorkflow;
	const router = new WorkflowRouter(taskWorkflow);

	// 1. Receive a command (HTTP request, Kafka message, etc.)
	const { workflowId, command } = parseInput(request);

	// 2. Load the workflow from storage
	const snapshot = await store.get(workflowId);
	const restored = definition.deserialize(snapshot as Parameters<typeof definition.deserialize>[0]);
	if (!restored.ok) throw new Error("Invalid workflow data");

	// 3. Dispatch the command
	const result = await router.dispatch(restored.workflow, command);

	// 4. Persist the updated workflow
	if (result.ok) {
		await store.set(workflowId, definition.serialize(result.workflow));
	}

	// 5. Publish events
	if (result.ok) {
		for (const event of result.events) {
			console.log(`Event: ${event.type}`, event.data);
		}
	}
})();
// #endregion pattern

// ── #hooks ────────────────────────────────────────────────────────────────────

// #region hooks
const hooksRouter = new WorkflowRouter(taskWorkflow)
	.on("transition", (from, to, workflow) => {
		console.log(`[${workflow.id}] ${from} → ${to}`);
	})
	.on("event", (event, workflow) => {
		console.log(`[${workflow.id}] Event: ${event.type}`);
	})
	.on("error", (error) => {
		console.error(`Error: ${error.category}`, error);
	})
	.state("Todo", ({ on }) => {
		/* ... */
	});
// #endregion hooks

void hooksRouter;
