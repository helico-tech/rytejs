/**
 * Kafka Consumer Integration Example
 *
 * Demonstrates how to use @rytejs/core with KafkaJS to process workflow
 * commands from a Kafka topic. Each incoming message triggers the
 * load -> dispatch -> persist -> publish pattern:
 *
 *   1. Load:    Restore a workflow snapshot from the store (or create a new one)
 *   2. Dispatch: Route the command through the workflow router
 *   3. Persist:  Snapshot the updated workflow and save it back to the store
 *   4. Publish:  Log emitted events (in production you'd publish these to a topic)
 *
 * Prerequisites:
 *   - A running Kafka broker (e.g. via docker-compose)
 *   - A "workflow-commands" topic created in the broker
 *
 * Message format on "workflow-commands":
 *   {
 *     "workflowId": "task-42",
 *     "command": { "type": "Assign", "payload": { "assignee": "alice" } }
 *   }
 */

import { defineWorkflow, type Workflow, WorkflowRouter, type WorkflowSnapshot } from "@rytejs/core";
import { Kafka, logLevel } from "kafkajs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Define the workflow
// ---------------------------------------------------------------------------

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		InProgress: z.object({ title: z.string(), assignee: z.string(), startedAt: z.coerce.date() }),
		Done: z.object({ title: z.string(), assignee: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Assign: z.object({ assignee: z.string() }),
		Start: z.object({}),
		Complete: z.object({}),
	},
	events: {
		TaskAssigned: z.object({ taskId: z.string(), assignee: z.string() }),
		TaskStarted: z.object({ taskId: z.string() }),
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotAssigned: z.object({}),
	},
});

type TaskWorkflow = Workflow<typeof taskWorkflow.config>;

// ---------------------------------------------------------------------------
// 2. Build the router with fluent chained .state() calls
// ---------------------------------------------------------------------------

const router = new WorkflowRouter(taskWorkflow)
	.state("Todo", (state) => {
		state
			.on("Assign", (ctx) => {
				ctx.update({ assignee: ctx.command.payload.assignee });
				ctx.emit({
					type: "TaskAssigned",
					data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee },
				});
			})
			.on("Start", (ctx) => {
				const assignee = ctx.data.assignee;
				if (!assignee) {
					ctx.error({ code: "NotAssigned", data: {} });
				}
				ctx.transition("InProgress", {
					title: ctx.data.title,
					assignee,
					startedAt: new Date(),
				});
				ctx.emit({ type: "TaskStarted", data: { taskId: ctx.workflow.id } });
			});
	})
	.state("InProgress", (state) => {
		state.on("Complete", (ctx) => {
			ctx.transition("Done", {
				title: ctx.data.title,
				assignee: ctx.data.assignee,
				completedAt: new Date(),
			});
			ctx.emit({ type: "TaskCompleted", data: { taskId: ctx.workflow.id } });
		});
	});

// ---------------------------------------------------------------------------
// 3. Register a transition hook for observability
// ---------------------------------------------------------------------------

// Hooks are observers -- they never affect dispatch outcomes. Use them for
// logging, metrics, or publishing side-effects.
router.on("transition", (from, to, workflow) => {
	console.log(`[hook] Workflow ${workflow.id} transitioned: ${from} -> ${to}`);
});

// ---------------------------------------------------------------------------
// 4. In-memory snapshot store
// ---------------------------------------------------------------------------

// In production, replace this with a database (Postgres, DynamoDB, etc.).
// The store holds WorkflowSnapshot objects, which are plain JSON-safe values
// produced by definition.snapshot() and consumed by definition.restore().
const store = new Map<string, WorkflowSnapshot<typeof taskWorkflow.config>>();

/** Load a workflow from the store, or return undefined if it doesn't exist. */
function loadWorkflow(id: string): TaskWorkflow | undefined {
	const snapshot = store.get(id);
	if (!snapshot) return undefined;

	const result = taskWorkflow.restore(snapshot);
	if (!result.ok) {
		console.error(`[store] Failed to restore workflow ${id}:`, result.error.message);
		return undefined;
	}
	return result.workflow;
}

/** Persist a workflow to the store as a snapshot. */
function saveWorkflow(workflow: TaskWorkflow): void {
	const snapshot = taskWorkflow.snapshot(workflow);
	store.set(workflow.id, snapshot);
}

// ---------------------------------------------------------------------------
// 5. Seed some workflows programmatically
// ---------------------------------------------------------------------------

// Since this consumer only reads from Kafka, there is no HTTP endpoint to
// create workflows. In a real system you might have a separate service or
// a Kafka message type for creation. Here we pre-seed the store so the
// consumer has something to work with.

function seedWorkflows(): void {
	const tasks = [
		{ id: "task-1", title: "Write documentation" },
		{ id: "task-2", title: "Review pull request" },
		{ id: "task-3", title: "Deploy to staging" },
	];

	for (const { id, title } of tasks) {
		const workflow = taskWorkflow.createWorkflow(id, {
			initialState: "Todo",
			data: { title },
		});
		saveWorkflow(workflow);
		console.log(`[seed] Created workflow ${id} in state Todo`);
	}
}

// ---------------------------------------------------------------------------
// 6. Message processing: load -> dispatch -> persist -> publish
// ---------------------------------------------------------------------------

/** Schema for validating incoming Kafka message values. */
const messageSchema = z.object({
	workflowId: z.string(),
	command: z.object({
		type: z.string(),
		payload: z.unknown(),
	}),
});

/**
 * Processes a single workflow command message.
 *
 * This is the core integration pattern:
 *   1. Parse and validate the incoming message
 *   2. Load the current workflow state from the store
 *   3. Dispatch the command through the router
 *   4. Persist the updated workflow back to the store
 *   5. Log (or publish) any emitted domain events
 */
async function processMessage(rawValue: string): Promise<void> {
	// Parse the message envelope
	const parsed = messageSchema.safeParse(JSON.parse(rawValue));
	if (!parsed.success) {
		console.error("[consumer] Invalid message format:", parsed.error.issues);
		return;
	}

	const { workflowId, command } = parsed.data;

	// 1. Load: restore the workflow from the snapshot store
	const workflow = loadWorkflow(workflowId);
	if (!workflow) {
		console.error(`[consumer] Workflow ${workflowId} not found in store`);
		return;
	}

	console.log(`[consumer] Processing ${command.type} for ${workflowId} (state: ${workflow.state})`);

	// 2. Dispatch: route the command to the appropriate handler
	const result = await router.dispatch(workflow, {
		type: command.type as "Assign" | "Start" | "Complete",
		payload: command.payload,
	});

	if (!result.ok) {
		console.error(`[consumer] Command ${command.type} failed:`, result.error);
		return;
	}

	// 3. Persist: snapshot the updated workflow and save it
	saveWorkflow(result.workflow);
	console.log(`[consumer] Workflow ${workflowId} persisted in state: ${result.workflow.state}`);

	// 4. Publish: in production, you would publish these events to an outbox
	//    table or a separate Kafka topic for downstream consumers.
	for (const event of result.events) {
		console.log(`[consumer] Event emitted: ${event.type}`, event.data);
	}
}

// ---------------------------------------------------------------------------
// 7. Kafka consumer setup
// ---------------------------------------------------------------------------

// NOTE: This requires a running Kafka broker. By default it connects to
// localhost:9092. Adjust the brokers list for your environment.

const kafka = new Kafka({
	clientId: "ryte-workflow-consumer",
	brokers: [process.env.KAFKA_BROKER ?? "localhost:9092"],
	logLevel: logLevel.WARN,
});

const consumer = kafka.consumer({ groupId: "workflow-processor" });

async function main(): Promise<void> {
	// Pre-seed the store with some workflows
	seedWorkflows();

	// Connect and subscribe to the commands topic
	await consumer.connect();
	await consumer.subscribe({ topic: "workflow-commands", fromBeginning: true });
	console.log("[consumer] Connected and subscribed to 'workflow-commands'");

	// Process each message using the load -> dispatch -> persist -> publish pattern
	await consumer.run({
		eachMessage: async ({ message }) => {
			if (!message.value) return;
			try {
				await processMessage(message.value.toString());
			} catch (err) {
				// In production, implement dead-letter queue or retry logic here
				console.error("[consumer] Unhandled error processing message:", err);
			}
		},
	});
}

main().catch((err) => {
	console.error("[consumer] Fatal error:", err);
	process.exit(1);
});
