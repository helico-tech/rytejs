import type { ConfigOf } from "@rytejs/core";
import { createKey, definePlugin, WorkflowRouter } from "@rytejs/core";
import { taskWorkflow } from "../fixtures.js";

declare const tracer: {
	startSpan(name: string): { setStatus(s: { code: number }): void; end(): void };
};
declare const SpanStatusCode: { OK: number; ERROR: number };
declare const auditLog: { record(entry: Record<string, unknown>): void };
declare const metrics: { increment(name: string, tags: Record<string, string>): void };

// type used to bind plugins to this workflow's config
type TaskConfig = ConfigOf<WorkflowRouter<typeof taskWorkflow.config>>;

// ── #logging ──────────────────────────────────────────────────────────────────

// #region logging
const startTimeKey = createKey<number>("startTime");

// biome-ignore lint/complexity/noBannedTypes: {} means "no deps", matching the router default
const loggingPlugin = definePlugin<TaskConfig, {}>((router) => {
	router.on("pipeline:start", ({ set }) => {
		set(startTimeKey, Date.now());
	});
	router.on("pipeline:end", ({ get, command, workflow }, result) => {
		const duration = Date.now() - get(startTimeKey);
		console.log(
			JSON.stringify({
				command: command.type,
				state: workflow.state,
				ok: result.ok,
				duration,
			}),
		);
	});
});
// #endregion logging

// ── #otel ─────────────────────────────────────────────────────────────────────

// #region otel
// biome-ignore lint/suspicious/noExplicitAny: external OTel span type
const spanKey = createKey<any>("span");

// biome-ignore lint/complexity/noBannedTypes: {} means "no deps", matching the router default
const otelPlugin = definePlugin<TaskConfig, {}>((router) => {
	router.on("pipeline:start", ({ command, set }) => {
		const span = tracer.startSpan(`ryte.dispatch.${command.type}`);
		set(spanKey, span);
	});
	router.on("pipeline:end", ({ get }, result) => {
		const span = get(spanKey);
		span.setStatus({ code: result.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
		span.end();
	});
});
// #endregion otel

// ── #audit ────────────────────────────────────────────────────────────────────

// #region audit
// biome-ignore lint/complexity/noBannedTypes: {} means "no deps", matching the router default
const auditPlugin = definePlugin<TaskConfig, {}>((router) => {
	router.on("transition", (from, to, workflow) => {
		auditLog.record({
			workflowId: workflow.id,
			from,
			to,
			timestamp: new Date(),
		});
	});
	router.on("error", (error, { workflow, command }) => {
		auditLog.record({
			workflowId: workflow.id,
			error: error.category,
			command: command.type,
			timestamp: new Date(),
		});
	});
});
// #endregion audit

// ── #metrics ──────────────────────────────────────────────────────────────────

// #region metrics
// biome-ignore lint/complexity/noBannedTypes: {} means "no deps", matching the router default
const metricsPlugin = definePlugin<TaskConfig, {}>((router) => {
	router.on("pipeline:end", ({ command, workflow }, result) => {
		metrics.increment("ryte.dispatch.total", {
			command: command.type,
			state: workflow.state,
			ok: String(result.ok),
		});
	});
	router.on("transition", (from, to) => {
		metrics.increment("ryte.transition.total", { from, to });
	});
});
// #endregion metrics

// ── #register ─────────────────────────────────────────────────────────────────

// #region register
const router = new WorkflowRouter(taskWorkflow);

router.use(loggingPlugin);
router.use(otelPlugin);
router.use(auditPlugin);
router.use(metricsPlugin);
// #endregion register

void router;
