/**
 * OpenTelemetry SDK initialization.
 *
 * MUST be imported before any other application code so the SDK can
 * register its TracerProvider, MeterProvider, and LoggerProvider globally.
 */

// Force JSON encoding — newer @opentelemetry/exporter-*-otlp-http packages
// default to protobuf, which older grafana/otel-lgtm collectors may reject (400).
process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/json";

import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
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

const logExporter = new OTLPLogExporter({
	url: "http://localhost:4318/v1/logs",
});

const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
logs.setGlobalLoggerProvider(loggerProvider);

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
	await loggerProvider.shutdown();
	await sdk.shutdown();
	process.exit(0);
});

console.log("[telemetry] OpenTelemetry SDK initialized — exporting to http://localhost:4318");
