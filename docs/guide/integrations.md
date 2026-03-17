# Integrations

Ryte is pure logic -- it has no opinion about where commands come from or where workflows are stored. Integrating with any runtime follows the same pattern.

## The Pattern

Every integration is five steps:

<<< @/snippets/guide/integrations.ts#pattern

The `snapshot()` and `restore()` methods handle serialization -- dates become ISO strings, data is validated against Zod schemas on restore. You can store snapshots in any JSON-compatible database.

## Express

```ts
import express from "express";
import { defineWorkflow, WorkflowRouter, type WorkflowSnapshot } from "@rytejs/core";
import { z } from "zod";

const taskWorkflow = defineWorkflow("task", { /* ... */ });

const router = new WorkflowRouter(taskWorkflow)
  .state("Todo", ({ on }) => { /* ... */ })
  .state("InProgress", ({ on }) => { /* ... */ });

const store = new Map<string, WorkflowSnapshot>();
const app = express();
app.use(express.json());

// Create a workflow
app.post("/workflows", (req, res) => {
  const { id, title } = req.body;
  const workflow = taskWorkflow.createWorkflow(id, {
    initialState: "Todo",
    data: { title },
  });
  store.set(id, taskWorkflow.snapshot(workflow));
  res.json(workflow);
});

// Dispatch a command
app.post("/workflows/:id/dispatch", async (req, res) => {
  const snapshot = store.get(req.params.id);
  if (!snapshot) return res.status(404).json({ error: "Not found" });

  const restored = taskWorkflow.restore(snapshot);
  if (!restored.ok) return res.status(500).json({ error: "Invalid data" });

  const result = await router.dispatch(restored.workflow, req.body);

  if (result.ok) {
    store.set(req.params.id, taskWorkflow.snapshot(result.workflow));
    res.json({ workflow: result.workflow, events: result.events });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Get workflow state
app.get("/workflows/:id", (req, res) => {
  const snapshot = store.get(req.params.id);
  if (!snapshot) return res.status(404).json({ error: "Not found" });

  const restored = taskWorkflow.restore(snapshot);
  if (!restored.ok) return res.status(500).json({ error: "Invalid data" });

  res.json(restored.workflow);
});

app.listen(3000);
```

See the full example: [examples/express](https://github.com/helico-tech/rytejs/tree/master/examples/express)

## Hono

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { defineWorkflow, WorkflowRouter, type WorkflowSnapshot } from "@rytejs/core";
import { z } from "zod";

const taskWorkflow = defineWorkflow("task", { /* ... */ });
const router = new WorkflowRouter(taskWorkflow)
  .state("Todo", ({ on }) => { /* ... */ });

const store = new Map<string, WorkflowSnapshot>();
const app = new Hono();

app.post("/workflows", async (c) => {
  const { id, title } = await c.req.json();
  const workflow = taskWorkflow.createWorkflow(id, {
    initialState: "Todo",
    data: { title },
  });
  store.set(id, taskWorkflow.snapshot(workflow));
  return c.json(workflow, 201);
});

app.post("/workflows/:id/dispatch", async (c) => {
  const snapshot = store.get(c.req.param("id"));
  if (!snapshot) return c.json({ error: "Not found" }, 404);

  const restored = taskWorkflow.restore(snapshot);
  if (!restored.ok) return c.json({ error: "Invalid data" }, 500);

  const result = await router.dispatch(restored.workflow, await c.req.json());

  if (result.ok) {
    store.set(c.req.param("id"), taskWorkflow.snapshot(result.workflow));
    return c.json({ workflow: result.workflow, events: result.events });
  }
  return c.json({ error: result.error }, 400);
});

app.get("/workflows/:id", (c) => {
  const snapshot = store.get(c.req.param("id"));
  if (!snapshot) return c.json({ error: "Not found" }, 404);

  const restored = taskWorkflow.restore(snapshot);
  if (!restored.ok) return c.json({ error: "Invalid data" }, 500);

  return c.json(restored.workflow);
});

serve({ fetch: app.fetch, port: 3000 });
```

See the full example: [examples/hono](https://github.com/helico-tech/rytejs/tree/master/examples/hono)

## Kafka Consumer

```ts
import { Kafka } from "kafkajs";
import { defineWorkflow, WorkflowRouter, type WorkflowSnapshot } from "@rytejs/core";
import { z } from "zod";

const taskWorkflow = defineWorkflow("task", { /* ... */ });
const router = new WorkflowRouter(taskWorkflow)
  .state("Todo", ({ on }) => { /* ... */ });

const store = new Map<string, WorkflowSnapshot>();

const kafka = new Kafka({ brokers: ["localhost:9092"] });
const consumer = kafka.consumer({ groupId: "workflow-processor" });

await consumer.connect();
await consumer.subscribe({ topic: "workflow-commands" });

await consumer.run({
  eachMessage: async ({ message }) => {
    const { workflowId, command } = JSON.parse(message.value!.toString());

    const snapshot = store.get(workflowId);
    if (!snapshot) {
      console.error(`Workflow ${workflowId} not found`);
      return;
    }

    const restored = taskWorkflow.restore(snapshot);
    if (!restored.ok) {
      console.error(`Invalid workflow data for ${workflowId}`);
      return;
    }

    const result = await router.dispatch(restored.workflow, command);

    if (result.ok) {
      store.set(workflowId, taskWorkflow.snapshot(result.workflow));
      for (const event of result.events) {
        console.log(`Event: ${event.type}`, event.data);
      }
    } else {
      console.error(`Dispatch failed: ${result.error.category}`);
    }
  },
});
```

See the full example: [examples/kafka](https://github.com/helico-tech/rytejs/tree/master/examples/kafka)

## Hooks for Observability

Use [hooks](/guide/hooks-and-plugins) to add logging, metrics, or event publishing without touching handlers:

<<< @/snippets/guide/integrations.ts#hooks

## Choosing a Storage Backend

Snapshots are plain JSON objects. Store them anywhere:

| Backend | Notes |
| ------- | ----- |
| PostgreSQL | Store as JSONB column, index on `id` and `state` |
| MongoDB | Store as document, natural fit |
| Redis | Store as JSON string, good for high-throughput |
| DynamoDB | Store as item, partition key on `id` |
| File system | `JSON.stringify` / `JSON.parse`, good for prototyping |

The `restore()` method validates data against Zod schemas on load, so you always get a valid workflow regardless of what's in storage.
