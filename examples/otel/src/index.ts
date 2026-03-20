/**
 * Entry point — starts the HTTP server with OpenTelemetry instrumentation.
 *
 * telemetry.ts MUST be imported first so the SDK is registered before
 * any @rytejs/otel code acquires a tracer or meter.
 */

import "./telemetry.js";

import { createServer } from "node:http";
import { WorkflowExecutor } from "@rytejs/core/executor";
import { memoryStore } from "@rytejs/core/store";
import { createOtelExecutorMiddleware } from "@rytejs/otel";
import { logger } from "./logger.js";
import { orderRouter, orderWorkflow } from "./workflow.js";

// ---------------------------------------------------------------------------
// Store + Executor
// ---------------------------------------------------------------------------

const store = memoryStore();
const executor = new WorkflowExecutor(orderRouter, store);
executor.use(createOtelExecutorMiddleware());

// ---------------------------------------------------------------------------
// Node.js HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
	logger.info({ method: req.method, url: req.url }, "incoming request");

	const url = new URL(`http://${req.headers.host}${req.url}`);
	const match = url.pathname.match(/^\/order\/([^/]+)$/);

	if (!match) {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
		return;
	}

	const id = match[1];

	try {
		if (req.method === "GET") {
			const stored = await store.load(id);
			if (!stored) {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Workflow not found" }));
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(stored.snapshot));
			return;
		}

		const body = await readBody(req);
		const parsed = JSON.parse(body);

		if (req.method === "PUT") {
			const workflow = orderWorkflow.createWorkflow(id, {
				initialState: parsed.initialState,
				data: parsed.data,
			});
			const snapshot = orderWorkflow.snapshot(workflow);
			await store.save({ id, snapshot, expectedVersion: 0 });
			res.writeHead(201, { "Content-Type": "application/json" });
			res.end(JSON.stringify(snapshot));
			logger.info({ id }, "workflow created");
			return;
		}

		if (req.method === "POST") {
			const result = await executor.execute(id, {
				type: parsed.type,
				payload: parsed.payload,
			});

			if (result.ok) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result.snapshot));
			} else {
				res.writeHead(422, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: result.error }));
			}
			return;
		}

		res.writeHead(405, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Method not allowed" }));
	} catch (err) {
		logger.error({ err }, "request error");
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Internal server error" }));
	}
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk: Buffer) => {
			data += chunk.toString();
		});
		req.on("end", () => resolve(data));
	});
}

const PORT = 4000;

server.listen(PORT, () => {
	console.log(`\n  Order workflow server listening on http://localhost:${PORT}`);
	console.log("  Telemetry exporting to OTel Collector at http://localhost:4318\n");
	console.log("  Grafana: http://localhost:3000  (admin / admin)");
	console.log("    → Explore → Tempo for traces, Prometheus for metrics\n");
	console.log("  Try the full order lifecycle:\n");
	console.log(`  1. Create:  curl -s -X PUT http://localhost:${PORT}/order/order-1 \\`);
	console.log(`              -H "Content-Type: application/json" \\`);
	console.log(
		`              -d '{"initialState":"Draft","data":{"items":[{"sku":"BOOK-1","name":"Ryte in Action","quantity":1,"priceInCents":2999}]}}' | jq`,
	);
	console.log(`\n  2. Place:   curl -s -X POST http://localhost:${PORT}/order/order-1 \\`);
	console.log(`              -H "Content-Type: application/json" \\`);
	console.log(
		`              -d '{"type":"Place","payload":{"customerEmail":"alice@example.com"}}' | jq`,
	);
	console.log(`\n  3. Pay:     curl -s -X POST http://localhost:${PORT}/order/order-1 \\`);
	console.log(`              -H "Content-Type: application/json" \\`);
	console.log(`              -d '{"type":"Pay","payload":{"transactionId":"txn_abc123"}}' | jq`);
	console.log(`\n  4. Ship:    curl -s -X POST http://localhost:${PORT}/order/order-1 \\`);
	console.log(`              -H "Content-Type: application/json" \\`);
	console.log(`              -d '{"type":"Ship","payload":{"trackingNumber":"TRACK-42"}}' | jq`);
	console.log(`\n  5. Inspect: curl -s http://localhost:${PORT}/order/order-1 | jq`);
	console.log("");
});
