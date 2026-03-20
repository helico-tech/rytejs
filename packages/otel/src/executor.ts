import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { defineExecutorPlugin, type ExecutorContext } from "@rytejs/core/executor";
import {
	ATTR_COMMAND_TYPE,
	ATTR_ERROR_CATEGORY,
	ATTR_RESULT,
	ATTR_WORKFLOW_ID,
	SCOPE_NAME,
} from "./conventions.js";

export interface OtelExecutorPluginOptions {
	tracerName?: string;
}

export function createOtelExecutorPlugin(options?: OtelExecutorPluginOptions) {
	const tracerName = options?.tracerName ?? SCOPE_NAME;
	const spanMap = new Map<string, Span>();

	return defineExecutorPlugin((executor) => {
		const tracer = trace.getTracer(tracerName);

		executor.on("execute:start", (ctx: ExecutorContext) => {
			const opName =
				ctx.operation === "execute" ? `ryte.execute.${ctx.command.type}` : "ryte.create";

			const span = tracer.startSpan(opName);
			span.setAttribute(ATTR_WORKFLOW_ID, ctx.id);
			span.setAttribute("ryte.operation", ctx.operation);

			if (ctx.operation === "execute") {
				span.setAttribute(ATTR_COMMAND_TYPE, ctx.command.type);
			}

			spanMap.set(ctx.id, span);
		});

		executor.on("execute:end", (ctx: ExecutorContext) => {
			const span = spanMap.get(ctx.id);
			if (!span) return;
			spanMap.delete(ctx.id);

			if (ctx.snapshot) {
				span.setAttribute(ATTR_RESULT, "ok");
				span.setAttribute("ryte.version", ctx.version);
				span.setStatus({ code: SpanStatusCode.OK });
			} else if (ctx.result && !ctx.result.ok) {
				span.setAttribute(ATTR_RESULT, "error");
				span.setAttribute(ATTR_ERROR_CATEGORY, ctx.result.error.category);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: ctx.result.error.category,
				});
			}

			span.end();
		});
	});
}
