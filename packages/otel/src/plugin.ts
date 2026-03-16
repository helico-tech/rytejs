import type { Meter, Tracer } from "@opentelemetry/api";
import { metrics, trace } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { logs } from "@opentelemetry/api-logs";
import type { Plugin, WorkflowConfig } from "@rytejs/core";
import { definePlugin } from "@rytejs/core";
import { SCOPE_NAME } from "./conventions.js";
import { emitDispatchLog, emitErrorLog } from "./logging.js";
import { createInstruments, recordDispatch, recordTransition } from "./metrics.js";
import {
	addDomainEventEvent,
	addTransitionEvent,
	endSpan,
	type SpanEntry,
	setSpanAttributes,
	spanName,
} from "./tracing.js";

export interface OtelPluginOptions {
	tracer?: Tracer;
	meter?: Meter;
	logger?: Logger;
}

export function createOtelPlugin<TConfig extends WorkflowConfig = WorkflowConfig, TDeps = unknown>(
	options?: OtelPluginOptions,
): Plugin<TConfig, TDeps> {
	const tracer = options?.tracer ?? trace.getTracer(SCOPE_NAME);
	const meter = options?.meter ?? metrics.getMeter(SCOPE_NAME);
	const logger = options?.logger ?? logs.getLogger(SCOPE_NAME);
	const instruments = createInstruments(meter);
	const spanMap = new Map<string, SpanEntry>();

	return definePlugin<WorkflowConfig, unknown>((router) => {
		router.on("dispatch:start", (workflow, command) => {
			const existing = spanMap.get(workflow.id);
			if (existing) {
				existing.span.end();
			}
			const span = tracer.startSpan(spanName(command.type as string));
			setSpanAttributes(span, workflow, command as { type: string; payload: unknown });
			spanMap.set(workflow.id, { span, startTime: Date.now() });
		});

		router.on("transition", (from, to, workflow) => {
			recordTransition(instruments, from as string, to as string);
			const entry = spanMap.get(workflow.id);
			if (entry) {
				addTransitionEvent(entry.span, from as string, to as string);
			}
		});

		router.on("event", (event, workflow) => {
			const entry = spanMap.get(workflow.id);
			if (entry) {
				addDomainEventEvent(entry.span, event.type as string);
			}
		});

		router.on("error", (error, _ctx) => {
			emitErrorLog(logger, error);
		});

		router.on("dispatch:end", (workflow, command, result) => {
			const entry = spanMap.get(workflow.id);
			if (entry) {
				const durationMs = Date.now() - entry.startTime;
				recordDispatch(instruments, command.type as string, workflow.state, durationMs, result);
				emitDispatchLog(
					logger,
					command.type as string,
					workflow.id,
					workflow.state,
					durationMs,
					result,
				);
				endSpan(entry.span, result);
				spanMap.delete(workflow.id);
			}
		});
	}) as Plugin<TConfig, TDeps>;
}
