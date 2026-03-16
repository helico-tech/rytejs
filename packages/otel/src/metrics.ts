import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { DispatchResult } from "@rytejs/core";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_RESULT,
	ATTR_TRANSITION_FROM,
	ATTR_TRANSITION_TO,
	ATTR_WORKFLOW_STATE,
	METRIC_DISPATCH_COUNT,
	METRIC_DISPATCH_DURATION,
	METRIC_TRANSITION_COUNT,
} from "./conventions.js";

export interface MetricInstruments {
	dispatchCount: Counter;
	dispatchDuration: Histogram;
	transitionCount: Counter;
}

export function createInstruments(meter: Meter): MetricInstruments {
	return {
		dispatchCount: meter.createCounter(METRIC_DISPATCH_COUNT, {
			description: "Number of workflow dispatches",
		}),
		dispatchDuration: meter.createHistogram(METRIC_DISPATCH_DURATION, {
			description: "Duration of workflow dispatches in milliseconds",
			unit: "ms",
		}),
		transitionCount: meter.createCounter(METRIC_TRANSITION_COUNT, {
			description: "Number of workflow state transitions",
		}),
	};
}

export function recordDispatch(
	instruments: MetricInstruments,
	commandType: string,
	workflowState: string,
	durationMs: number,
	result: DispatchResult,
): void {
	const attrs: Record<string, string> = {
		[ATTR_COMMAND_TYPE]: commandType,
		[ATTR_WORKFLOW_STATE]: workflowState,
		[ATTR_RESULT]: result.ok ? "ok" : "error",
	};
	if (!result.ok) {
		attrs[ATTR_ERROR_CATEGORY] = result.error.category;
	}
	instruments.dispatchCount.add(1, attrs);
	instruments.dispatchDuration.record(durationMs, {
		[ATTR_COMMAND_TYPE]: commandType,
		[ATTR_WORKFLOW_STATE]: workflowState,
		[ATTR_RESULT]: result.ok ? "ok" : "error",
	});
}

export function recordTransition(instruments: MetricInstruments, from: string, to: string): void {
	instruments.transitionCount.add(1, {
		[ATTR_TRANSITION_FROM]: from,
		[ATTR_TRANSITION_TO]: to,
	});
}
