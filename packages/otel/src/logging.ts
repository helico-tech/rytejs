import type { Logger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { DispatchResult, PipelineError } from "@rytejs/core";
import {
	ATTR_COMMAND_TYPE,
	ATTR_DISPATCH_DURATION_MS,
	ATTR_ERROR_CATEGORY,
	ATTR_ERROR_CODE,
	ATTR_ERROR_DEPENDENCY,
	ATTR_ERROR_SOURCE,
	ATTR_RESULT,
	ATTR_WORKFLOW_ID,
	ATTR_WORKFLOW_STATE,
} from "./conventions.js";

export function emitDispatchLog(
	logger: Logger,
	commandType: string,
	workflowId: string,
	workflowState: string,
	durationMs: number,
	result: DispatchResult,
): void {
	const ok = result.ok;
	const attrs: Record<string, string | number> = {
		[ATTR_COMMAND_TYPE]: commandType,
		[ATTR_WORKFLOW_ID]: workflowId,
		[ATTR_WORKFLOW_STATE]: workflowState,
		[ATTR_RESULT]: ok ? "ok" : "error",
		[ATTR_DISPATCH_DURATION_MS]: durationMs,
	};
	if (!ok) {
		attrs[ATTR_ERROR_CATEGORY] = result.error.category;
		if ("code" in result.error) {
			attrs[ATTR_ERROR_CODE] = result.error.code as string;
		}
	}
	logger.emit({
		severityNumber: ok ? SeverityNumber.INFO : SeverityNumber.WARN,
		severityText: ok ? "INFO" : "WARN",
		body: `dispatch ${commandType} → ${ok ? "ok" : "error"}`,
		attributes: attrs,
	});
}

export function emitErrorLog(logger: Logger, error: PipelineError): void {
	const category = error.category;
	const isHighSeverity = category === "unexpected" || category === "dependency";
	let body: string;
	if (category === "domain") {
		body = `error domain: ${error.code}`;
	} else {
		const detail = "message" in error ? error.message : category;
		body = `error ${category}: ${detail}`;
	}

	const attrs: Record<string, string> = {
		[ATTR_ERROR_CATEGORY]: error.category,
	};
	if ("code" in error) attrs[ATTR_ERROR_CODE] = error.code as string;
	if ("source" in error) attrs[ATTR_ERROR_SOURCE] = error.source;
	if (error.category === "dependency") attrs[ATTR_ERROR_DEPENDENCY] = error.name;

	logger.emit({
		severityNumber: isHighSeverity ? SeverityNumber.ERROR : SeverityNumber.WARN,
		severityText: isHighSeverity ? "ERROR" : "WARN",
		body,
		attributes: attrs,
	});
}
