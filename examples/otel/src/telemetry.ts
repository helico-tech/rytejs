/**
 * OpenTelemetry SDK initialization.
 *
 * MUST be imported before any other application code so the SDK can
 * register its TracerProvider and MeterProvider globally.
 */

import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const resource = new Resource({
	[ATTR_SERVICE_NAME]: "ryte-otel-example",
	[ATTR_SERVICE_VERSION]: "0.1.0",
});

const traceExporter = new OTLPTraceExporter({
	url: "http://localhost:4318/v1/traces",
});

const metricExporter = new OTLPMetricExporter({
	url: "http://localhost:4318/v1/metrics",
});

const sdk = new NodeSDK({
	resource,
	spanProcessors: [new BatchSpanProcessor(traceExporter)],
	metricReader: new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: 5000,
	}),
});

sdk.start();

process.on("SIGTERM", async () => {
	await sdk.shutdown();
	process.exit(0);
});

console.log("[telemetry] OpenTelemetry SDK initialized — exporting to http://localhost:4318");
