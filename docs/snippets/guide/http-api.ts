import { WorkflowRouter } from "@rytejs/core";
import { memoryStore } from "@rytejs/core/engine";
import { WorkflowExecutor, withStore } from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
import { articleWorkflow, taskRouter } from "../fixtures.js";

// #region create-fetch
const store = memoryStore();
const executor = new WorkflowExecutor(taskRouter).use(withStore(store));

const fetch = createFetch({ task: executor }, store);

// Use with any Web Standard API compatible server:
// Bun.serve({ fetch })
// Deno.serve(fetch)

// Routes:
// PUT  /task/:id   → create workflow
// POST /task/:id   → execute command
// GET  /task/:id   → load workflow
// #endregion create-fetch

// #region multiple-executors
const articleRouter = new WorkflowRouter(articleWorkflow);
const articleExecutor = new WorkflowExecutor(articleRouter).use(withStore(store));

const multiFetch = createFetch(
	{
		task: executor,
		article: articleExecutor,
	},
	store,
);

// PUT  /task/order-1     → create task workflow
// PUT  /article/post-1   → create article workflow
// POST /task/order-1     → dispatch to task executor
// POST /article/post-1   → dispatch to article executor
// #endregion multiple-executors

// #region hono-integration
// Hono example (works with any Fetch API framework)
//
// import { Hono } from "hono";
//
// const app = new Hono();
// const handler = createFetch({ task: executor }, store);
//
// app.all("/task/*", (c) => handler(c.req.raw));
//
// export default app;
// #endregion hono-integration

void fetch;
void multiFetch;
