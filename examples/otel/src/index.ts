/**
 * Entry point — starts the HTTP server with OpenTelemetry instrumentation.
 *
 * telemetry.ts MUST be imported first so the SDK is registered before
 * any @rytejs/otel code acquires a tracer or meter.
 */

import "./telemetry.js";

import { createServer } from "node:http";
import { createEngine, memoryStore } from "@rytejs/core/engine";
import { createHandler } from "@rytejs/core/http";
import { orderRouter } from "./workflow.js";

// ---------------------------------------------------------------------------
// Engine + HTTP handler
// ---------------------------------------------------------------------------

const engine = createEngine({
	store: memoryStore(),
	routers: { order: orderRouter },
});

const handler = createHandler({ engine });

// ---------------------------------------------------------------------------
// Node.js HTTP server (Request/Response adapter)
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
	const url = `http://${req.headers.host}${req.url}`;
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (typeof value === "string") headers.set(key, value);
	}

	const hasBody = req.method !== "GET" && req.method !== "HEAD";
	let body: string | undefined;
	if (hasBody) {
		body = await new Promise<string>((resolve) => {
			let data = "";
			req.on("data", (chunk: Buffer) => {
				data += chunk.toString();
			});
			req.on("end", () => resolve(data));
		});
	}

	const request = new Request(url, {
		method: req.method,
		headers,
		body: hasBody ? body : undefined,
	});

	const response = await handler(request);
	const responseBody = await response.text();

	res.writeHead(response.status, {
		"Content-Type": response.headers.get("Content-Type") ?? "application/json",
	});
	res.end(responseBody);
});

const PORT = 3000;

server.listen(PORT, () => {
	console.log(`\n  Order workflow server listening on http://localhost:${PORT}`);
	console.log("  Telemetry exporting to OTel Collector at http://localhost:4318\n");
	console.log("  Observability UIs:");
	console.log("    Jaeger:     http://localhost:16686");
	console.log("    Prometheus: http://localhost:9090");
	console.log("    Grafana:    http://localhost:3001  (admin/admin)\n");
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
