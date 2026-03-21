/**
 * Express + @rytejs/core Integration Example
 *
 * Demonstrates the standard load -> dispatch -> persist -> publish pattern
 * for running workflow state machines behind an HTTP API.
 *
 * Endpoints:
 *   POST /workflows          — create a new task workflow
 *   POST /workflows/:id/dispatch — dispatch a command to an existing workflow
 *   GET  /workflows/:id      — retrieve the current workflow snapshot
 */

import { defineWorkflow, WorkflowRouter, type WorkflowSnapshot } from "@rytejs/core";
import express from "express";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Define the workflow schema
// ---------------------------------------------------------------------------
// Every workflow begins with a definition: the set of states, commands,
// events, and domain errors it supports. Zod schemas validate data at
// every boundary — creation, command dispatch, state transitions, and
// snapshot deserialize.

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

// ---------------------------------------------------------------------------
// 2. Build the command router
// ---------------------------------------------------------------------------
// The router maps (state, command) pairs to handler functions. Handlers
// receive a context object that lets them read workflow data, update it,
// transition to another state, emit domain events, or signal errors.
// The fluent .state().state() API keeps related logic grouped together.

const router = new WorkflowRouter(taskWorkflow)
	.state("Todo", (state) => {
		state
			.on("Assign", (ctx) => {
				// Update the current state's data without transitioning.
				ctx.update({ assignee: ctx.command.payload.assignee });

				// Emit a domain event — these are collected and returned with the
				// dispatch result so the caller can publish them downstream.
				ctx.emit({
					type: "TaskAssigned",
					data: { taskId: ctx.workflow.id, assignee: ctx.command.payload.assignee },
				});
			})
			.on("Start", (ctx) => {
				const assignee = ctx.data.assignee;

				// Domain errors are signaled via ctx.error(). The router catches
				// the signal and returns a structured error result — no exceptions
				// leak to the HTTP layer.
				if (!assignee) {
					ctx.error({ code: "NotAssigned", data: {} });
				}

				// Transition to a new state with fully validated data.
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
// 3. Register lifecycle hooks
// ---------------------------------------------------------------------------
// Hooks are observers — they never affect dispatch results. Use them for
// logging, metrics, or side-effects like sending notifications.

router.on("transition", (from, to, workflow) => {
	console.log(`[hook] Workflow ${workflow.id} transitioned: ${from} -> ${to}`);
});

// ---------------------------------------------------------------------------
// 4. In-memory persistence store
// ---------------------------------------------------------------------------
// In production you would swap this for a database. The key insight is that
// WorkflowSnapshot is a plain JSON-safe object — it serializes cleanly to
// any storage backend.

const store = new Map<string, WorkflowSnapshot>();

// ---------------------------------------------------------------------------
// 5. Express application
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

/**
 * POST /workflows
 *
 * Create a new task workflow in the Todo state.
 *
 * Body: { id: string, title: string }
 */
app.post("/workflows", (req, res) => {
	const { id, title } = req.body;

	if (!id || !title) {
		res.status(400).json({ error: "id and title are required" });
		return;
	}

	if (store.has(id)) {
		res.status(409).json({ error: `Workflow ${id} already exists` });
		return;
	}

	// Create the workflow instance and immediately snapshot it for storage.
	const workflow = taskWorkflow.createWorkflow(id, {
		initialState: "Todo",
		data: { title },
	});
	const snapshot = taskWorkflow.serialize(workflow);

	// Persist the snapshot.
	store.set(id, snapshot);

	console.log(`[create] Workflow ${id} created in state Todo`);
	res.status(201).json(snapshot);
});

/**
 * POST /workflows/:id/dispatch
 *
 * Dispatch a command to an existing workflow. This endpoint demonstrates
 * the full load -> dispatch -> persist -> publish cycle:
 *
 *   1. Load   — read the snapshot from the store and deserialize it
 *   2. Dispatch — run the command through the router
 *   3. Persist — serialize the updated workflow and save it
 *   4. Publish — return emitted events to the caller
 *
 * Body: { type: string, payload: object }
 */
app.post("/workflows/:id/dispatch", async (req, res) => {
	const { id } = req.params;
	const { type, payload } = req.body;

	if (!type) {
		res.status(400).json({ error: "command type is required" });
		return;
	}

	// ---- 1. Load ----
	// Retrieve the persisted snapshot and rehydrate it into a live workflow
	// instance. deserialize() validates the snapshot data against the current
	// schema, catching any schema-drift issues early.
	const snapshot = store.get(id);
	if (!snapshot) {
		res.status(404).json({ error: `Workflow ${id} not found` });
		return;
	}

	const restored = taskWorkflow.deserialize(snapshot);
	if (!restored.ok) {
		res.status(500).json({ error: "Failed to deserialize workflow", details: restored.error });
		return;
	}

	// ---- 2. Dispatch ----
	// Send the command through the router. The router validates the command
	// payload, finds the matching handler, runs middleware, and returns a
	// discriminated result — either { ok: true, workflow, events } or
	// { ok: false, error }.
	const result = await router.dispatch(restored.workflow, {
		type: type as "Assign" | "Start" | "Complete",
		payload: payload ?? {},
	});

	if (!result.ok) {
		// Domain and validation errors are structured — return them as-is.
		res.status(422).json({ error: result.error });
		return;
	}

	// ---- 3. Persist ----
	// Snapshot the updated workflow and write it back to the store.
	const updatedSnapshot = taskWorkflow.serialize(result.workflow);
	store.set(id, updatedSnapshot);

	// ---- 4. Publish ----
	// In a real system you would publish these events to a message bus.
	// Here we simply return them in the response so the caller can see
	// what happened.
	console.log(`[dispatch] Workflow ${id} is now in state ${result.workflow.state}`);
	if (result.events.length > 0) {
		console.log(`[events]`, result.events);
	}

	res.json({
		workflow: updatedSnapshot,
		events: result.events,
	});
});

/**
 * GET /workflows/:id
 *
 * Return the current snapshot for a workflow. Since snapshots are plain
 * JSON objects, no transformation is needed.
 */
app.get("/workflows/:id", (req, res) => {
	const { id } = req.params;
	const snapshot = store.get(id);

	if (!snapshot) {
		res.status(404).json({ error: `Workflow ${id} not found` });
		return;
	}

	res.json(snapshot);
});

// ---------------------------------------------------------------------------
// 6. Start the server
// ---------------------------------------------------------------------------

app.listen(3000, () => {
	console.log("Task workflow server listening on http://localhost:3000");
	console.log("");
	console.log("Try it out:");
	console.log(
		'  curl -X POST http://localhost:3000/workflows -H "Content-Type: application/json" -d \'{"id":"task-1","title":"Write docs"}\'',
	);
	console.log(
		'  curl -X POST http://localhost:3000/workflows/task-1/dispatch -H "Content-Type: application/json" -d \'{"type":"Assign","payload":{"assignee":"alice"}}\'',
	);
	console.log(
		'  curl -X POST http://localhost:3000/workflows/task-1/dispatch -H "Content-Type: application/json" -d \'{"type":"Start","payload":{}}\'',
	);
	console.log(
		'  curl -X POST http://localhost:3000/workflows/task-1/dispatch -H "Content-Type: application/json" -d \'{"type":"Complete","payload":{}}\'',
	);
	console.log("  curl http://localhost:3000/workflows/task-1");
});
