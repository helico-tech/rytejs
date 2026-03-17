/**
 * Application-level pino logger configured with the OpenTelemetry transport.
 *
 * All log records are forwarded to Loki (or any OTLP-compatible backend)
 * via the global LoggerProvider registered in telemetry.ts.
 */

import pino from "pino";

const transport = pino.transport({
	target: "pino-opentelemetry-transport",
	options: {
		loggerName: "ryte-otel-example",
		serviceVersion: "0.1.0",
	},
});

export const logger = pino(transport);
