import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import type { DispatchResult, PipelineError, Workflow } from "@rytejs/core";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_ERROR_DEPENDENCY,
	ATTR_ERROR_MESSAGE,
	ATTR_ERROR_SOURCE,
	ATTR_EVENT_TYPE,
	ATTR_TRANSITION_FROM,
	ATTR_TRANSITION_TO,
	ATTR_WORKFLOW_DEFINITION,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
	SPAN_EVENT_DOMAIN_EVENT,
	SPAN_EVENT_TRANSITION,
	SPAN_NAME_PREFIX,
} from "./conventions.js";

export interface SpanEntry {
	span: Span;
	startTime: number;
}

export function setSpanAttributes(
	span: Span,
	workflow: Workflow,
	command: { type: string; payload: unknown },
): void {
	span.setAttribute(ATTR_WORKFLOW_ID, workflow.id);
	span.setAttribute(ATTR_WORKFLOW_STATE, workflow.state);
	span.setAttribute(ATTR_WORKFLOW_DEFINITION, workflow.definitionName);
	span.setAttribute(ATTR_COMMAND_TYPE, command.type);
}

export function addTransitionEvent(span: Span, from: string, to: string): void {
	span.addEvent(SPAN_EVENT_TRANSITION, {
		[ATTR_TRANSITION_FROM]: from,
		[ATTR_TRANSITION_TO]: to,
	});
}

export function addDomainEventEvent(span: Span, eventType: string): void {
	span.addEvent(SPAN_EVENT_DOMAIN_EVENT, {
		[ATTR_EVENT_TYPE]: eventType,
	});
}

export function setErrorAttributes(span: Span, error: PipelineError): void {
	span.setAttribute(ATTR_ERROR_CATEGORY, error.category);
	if ("code" in error) {
		span.setAttribute(ATTR_ERROR_CODE, error.code as string);
	}
	if ("source" in error) {
		span.setAttribute(ATTR_ERROR_SOURCE, error.source);
	}
	if (error.category === "dependency") {
		span.setAttribute(ATTR_ERROR_DEPENDENCY, error.name);
	}
	if ("message" in error) {
		span.setAttribute(ATTR_ERROR_MESSAGE, error.message);
	}
}

export function endSpan(span: Span, result: DispatchResult): void {
	if (result.ok) {
		span.setStatus({ code: SpanStatusCode.OK });
	} else {
		const description =
			"message" in result.error ? result.error.message : (result.error.code as string);
		span.setStatus({ code: SpanStatusCode.ERROR, message: description });
		setErrorAttributes(span, result.error);
	}
	span.end();
}

export function spanName(commandType: string): string {
	return `${SPAN_NAME_PREFIX}.${commandType}`;
}
