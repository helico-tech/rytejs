import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { ExecutorContext, ExecutorMiddleware } from "@rytejs/core/executor";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_RESULT,
	ATTR_WORKFLOW_ID,
	SCOPE_NAME,
} from "./conventions.js";

export interface OtelExecutorMiddlewareOptions {
	tracerName?: string;
}

export function createOtelExecutorMiddleware(
	options?: OtelExecutorMiddlewareOptions,
): ExecutorMiddleware {
	const tracerName = options?.tracerName ?? SCOPE_NAME;

	return async (ctx: ExecutorContext, next: () => Promise<void>) => {
		const tracer = trace.getTracer(tracerName);
		const spanName = `ryte.execute.${ctx.command.type}`;

		const span = tracer.startSpan(spanName);
		span.setAttribute(ATTR_WORKFLOW_ID, ctx.id);
		span.setAttribute(ATTR_COMMAND_TYPE, ctx.command.type);

		try {
			await next();

			if (ctx.snapshot) {
				span.setAttribute(ATTR_RESULT, "ok");
				span.setStatus({ code: SpanStatusCode.OK });
			} else if (ctx.result && !ctx.result.ok) {
				span.setAttribute(ATTR_RESULT, "error");
				span.setAttribute(ATTR_ERROR_CATEGORY, ctx.result.error.category);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: ctx.result.error.category,
				});
			}
		} catch (err) {
			span.setAttribute(ATTR_RESULT, "error");
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err),
			});
			throw err;
		} finally {
			span.end();
		}
	};
}
