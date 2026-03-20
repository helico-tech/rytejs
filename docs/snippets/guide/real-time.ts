import { memoryStore } from "@rytejs/core/engine";
import {
	createSubscriberRegistry,
	WorkflowExecutor,
	withBroadcast,
	withStore,
} from "@rytejs/core/executor";
import { createFetch } from "@rytejs/core/http";
import { handlePolling, handleSSE } from "@rytejs/core/transport/server";
import { taskRouter } from "../fixtures.js";

// #region subscriber-registry
const subscribers = createSubscriberRegistry();

// Subscribe to updates for a specific workflow
const unsubscribe = subscribers.subscribe("task-1", (message) => {
	console.log("Update:", message.snapshot, message.version);
	console.log("Events:", message.events);
});

// Later: stop listening
unsubscribe();
// #endregion subscriber-registry

// #region with-broadcast
const store = memoryStore();

const executor = new WorkflowExecutor(taskRouter)
	.use(withBroadcast(subscribers))
	.use(withStore(store));

// After a successful create/execute, all subscribers for that workflow ID
// are notified with { snapshot, version, events }
// #endregion with-broadcast

// #region middleware-ordering
// withBroadcast wraps withStore:
//
//   Request → withBroadcast → withStore → core handler
//                                         (dispatch + save)
//                              ← version set by withStore
//             ← broadcast fires with correct version
//
// If you swap the order, broadcast fires before the version is set.
const correctOrder = new WorkflowExecutor(taskRouter)
	.use(withBroadcast(subscribers)) // outer: fires after inner completes
	.use(withStore(store)); // inner: sets version after save
// #endregion middleware-ordering

// #region handle-sse
// SSE endpoint — streams updates as Server-Sent Events
const sseHandler = (req: Request) => handleSSE(req, subscribers);
// Extracts workflow ID from URL path
// Streams JSON events: { snapshot, version, events }
// Auto-cleanup on client disconnect (AbortSignal)
// #endregion handle-sse

// #region handle-polling
// Polling endpoint — returns current workflow state
const pollingHandler = (req: Request) => handlePolling(req, store);
// Extracts workflow ID from URL path
// Returns JSON: { snapshot, version }
// Returns 404 if workflow not found
// #endregion handle-polling

// #region wiring
const api = createFetch({ task: executor }, store);

const server = {
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		// SSE streaming endpoint
		if (url.pathname.startsWith("/sse/")) {
			return handleSSE(req, subscribers);
		}

		// Polling endpoint
		if (url.pathname.startsWith("/poll/")) {
			return handlePolling(req, store);
		}

		// HTTP API (create/execute/load)
		return api(req);
	},
};

// Bun.serve(server)
// Deno.serve(server.fetch)
// #endregion wiring

void correctOrder;
void sseHandler;
void pollingHandler;
void server;
