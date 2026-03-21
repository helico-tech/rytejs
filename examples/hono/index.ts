/**
 * Ryte + Hono Integration Example
 *
 * Demonstrates how to use @rytejs/core with a Hono HTTP server.
 * This example implements a task workflow with an in-memory store,
 * showing the standard load -> dispatch -> persist -> publish pattern.
 */

import { serve } from "@hono/node-server";
import { defineWorkflow, WorkflowRouter, type WorkflowSnapshot } from "@rytejs/core";
import { Hono } from "hono";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Define the workflow — states, commands, events, and errors
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

// ---------------------------------------------------------------------------
// 2. Wire up the router — map states to command handlers using fluent API
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
// 3. Register hooks — observe lifecycle events (logging, metrics, etc.)
// ---------------------------------------------------------------------------

router.on("transition", (from, to, workflow) => {
	console.log(`[transition] workflow=${workflow.id} ${from} -> ${to}`);
});

// ---------------------------------------------------------------------------
// 4. In-memory store — snapshots keyed by workflow ID
// ---------------------------------------------------------------------------

const store = new Map<string, WorkflowSnapshot<typeof taskWorkflow.config>>();

// ---------------------------------------------------------------------------
// 5. Hono HTTP server — expose the workflow over REST endpoints
// ---------------------------------------------------------------------------

const app = new Hono();

/**
 * POST /workflows
 * Create a new workflow instance.
 *
 * Body: { id: string, title: string }
 */
app.post("/workflows", async (c) => {
	const body = await c.req.json<{ id: string; title: string }>();

	if (!body.id || !body.title) {
		return c.json({ error: "id and title are required" }, 400);
	}

	if (store.has(body.id)) {
		return c.json({ error: "Workflow already exists" }, 409);
	}

	// Create a fresh workflow in the Todo state
	const workflow = taskWorkflow.createWorkflow(body.id, {
		initialState: "Todo",
		data: { title: body.title },
	});

	// Persist: serialize the workflow into a JSON-safe snapshot
	const snapshot = taskWorkflow.serialize(workflow);
	store.set(body.id, snapshot);

	console.log(`[created] workflow=${body.id} state=${snapshot.state}`);

	return c.json({ snapshot }, 201);
});

/**
 * POST /workflows/:id/dispatch
 * Dispatch a command to an existing workflow.
 *
 * Body: { type: string, payload: object }
 *
 * This handler demonstrates the full load -> dispatch -> persist -> publish
 * pattern that you would use in production:
 *
 *   1. Load:    Deserialize the workflow from the persisted snapshot
 *   2. Dispatch: Run the command through the router (validates, executes handler)
 *   3. Persist: Serialize the updated workflow and save it back to the store
 *   4. Publish: Return events to the caller (in production, publish to a bus)
 */
app.post("/workflows/:id/dispatch", async (c) => {
	const { id } = c.req.param();
	const body = await c.req.json<{ type: string; payload: Record<string, unknown> }>();

	// --- Load ---
	const existing = store.get(id);
	if (!existing) {
		return c.json({ error: "Workflow not found" }, 404);
	}

	// Deserialize the snapshot back into a live workflow object.
	// deserialize() re-validates the data against the state schema, so it can fail
	// if the snapshot is corrupt or the schema has evolved.
	const restored = taskWorkflow.deserialize(existing);
	if (!restored.ok) {
		return c.json(
			{ error: "Failed to deserialize workflow", details: restored.error.message },
			500,
		);
	}

	// --- Dispatch ---
	const result = await router.dispatch(restored.workflow, {
		type: body.type,
		payload: body.payload ?? {},
	});

	if (!result.ok) {
		// Domain errors, validation errors, and routing errors are all returned
		// as structured error objects — never thrown.
		return c.json({ error: result.error }, 422);
	}

	// --- Persist ---
	const snapshot = taskWorkflow.serialize(result.workflow);
	store.set(id, snapshot);

	// --- Publish ---
	// In production you would publish result.events to a message bus here.
	// For this example, we just return them in the response.
	console.log(
		`[dispatched] workflow=${id} command=${body.type} -> state=${snapshot.state} events=${result.events.length}`,
	);

	return c.json({
		snapshot,
		events: result.events,
	});
});

/**
 * GET /workflows/:id
 * Retrieve the current snapshot of a workflow.
 */
app.get("/workflows/:id", (c) => {
	const { id } = c.req.param();
	const snapshot = store.get(id);

	if (!snapshot) {
		return c.json({ error: "Workflow not found" }, 404);
	}

	return c.json({ snapshot });
});

// ---------------------------------------------------------------------------
// 6. Start the server
// ---------------------------------------------------------------------------

const port = 3000;

serve({ fetch: app.fetch, port }, () => {
	console.log(`Ryte + Hono server running on http://localhost:${port}`);
	console.log();
	console.log("Try it out:");
	console.log(
		`  curl -X POST http://localhost:${port}/workflows -H 'Content-Type: application/json' -d '{"id":"task-1","title":"Write docs"}'`,
	);
	console.log(
		`  curl -X POST http://localhost:${port}/workflows/task-1/dispatch -H 'Content-Type: application/json' -d '{"type":"Assign","payload":{"assignee":"alice"}}'`,
	);
	console.log(
		`  curl -X POST http://localhost:${port}/workflows/task-1/dispatch -H 'Content-Type: application/json' -d '{"type":"Start","payload":{}}'`,
	);
	console.log(
		`  curl -X POST http://localhost:${port}/workflows/task-1/dispatch -H 'Content-Type: application/json' -d '{"type":"Complete","payload":{}}'`,
	);
	console.log(`  curl http://localhost:${port}/workflows/task-1`);
});
