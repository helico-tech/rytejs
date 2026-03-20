import { memoryStore } from "@rytejs/core/engine";
import {
	createSubscriberRegistry,
	WorkflowExecutor,
	withBroadcast,
	withStore,
} from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
import { sseTransport } from "@rytejs/core/transport";
import { handleSSE } from "@rytejs/core/transport/server";
import { taskRouter } from "../fixtures.js";

// #region full-server
const store = memoryStore();
const subscribers = createSubscriberRegistry();

const executor = new WorkflowExecutor(taskRouter)
	.use(withBroadcast(subscribers))
	.use(withStore(store));

const api = createFetch({ task: executor }, store);

const server = {
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		if (url.pathname.startsWith("/sse/")) {
			return handleSSE(req, subscribers);
		}

		return api(req);
	},
};

// Bun.serve(server)
// Deno.serve(server.fetch)
// #endregion full-server

// #region full-client
const transport = sseTransport("http://localhost:3000/task");

// In your React app:
//
//   import { createWorkflowStore } from "@rytejs/react";
//
//   const store = createWorkflowStore(
//     taskRouter,
//     { state: "Todo", data: { title: "Write docs", priority: 0 }, id: "task-1" },
//     { transport },
//   );
//
//   // Dispatches go through the server
//   await store.dispatch("Start", { assignee: "alice" });
//
//   // Incoming broadcasts update the store automatically
//   // Call store.cleanup() on unmount
// #endregion full-client

void server;
void transport;
