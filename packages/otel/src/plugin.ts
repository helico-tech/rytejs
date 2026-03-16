import type { Meter, Span, Tracer } from "@opentelemetry/api";
import { metrics, trace } from "@opentelemetry/api";
import type { Plugin, WorkflowConfig } from "@rytejs/core";
import { createKey, definePlugin } from "@rytejs/core";
import { SCOPE_NAME } from "./conventions.js";
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
}

export function createOtelPlugin<TConfig extends WorkflowConfig = WorkflowConfig, TDeps = unknown>(
	options?: OtelPluginOptions,
): Plugin<TConfig, TDeps> {
	const tracer = options?.tracer ?? trace.getTracer(SCOPE_NAME);
	const meter = options?.meter ?? metrics.getMeter(SCOPE_NAME);
	const instruments = createInstruments(meter);
	const spanMap = new Map<string, SpanEntry>();
	const spanKey = createKey<Span>("ryte.otel.span");

	// biome-ignore lint/suspicious/noExplicitAny: plugin hooks only use base Workflow/DispatchResult types — safe to erase config
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

		router.on("pipeline:start", (ctx) => {
			const entry = spanMap.get(ctx.workflow.id);
			if (entry) {
				ctx.set(spanKey, entry.span);
			}
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

		router.on("error", (_error, _ctx) => {
			// Error attributes are set when span ends in dispatch:end
			// The error hook provides early visibility but endSpan handles all cases
		});

		router.on("dispatch:end", (workflow, command, result) => {
			const entry = spanMap.get(workflow.id);
			if (entry) {
				const durationMs = Date.now() - entry.startTime;
				recordDispatch(instruments, command.type as string, workflow.state, durationMs, result);
				endSpan(entry.span, result);
				spanMap.delete(workflow.id);
			}
		});
	}) as Plugin<TConfig, TDeps>;
}
