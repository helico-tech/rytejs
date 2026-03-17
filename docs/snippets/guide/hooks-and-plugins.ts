import type { ConfigOf } from "@rytejs/core";
import { definePlugin, WorkflowRouter } from "@rytejs/core";
import { taskWorkflow } from "../fixtures.js";

declare const myLogger: { warn(...args: unknown[]): void };
declare const auditLog: { record(...args: unknown[]): void };

// ── #lifecycle-hooks ──────────────────────────────────────────────────────────

// #region lifecycle-hooks
const router = new WorkflowRouter(taskWorkflow);

router.on("pipeline:start", ({ command }) => {
	console.log(`→ ${command.type}`);
});

router.on("pipeline:end", (_ctx, result) => {
	console.log(`← ${result.ok ? "ok" : "error"}`);
});

router.on("transition", (from, to) => {
	console.log(`${from} → ${to}`);
});

router.on("error", (error, _ctx) => {
	console.log(`error: ${error.category}`);
});

router.on("event", (event) => {
	console.log(`event: ${event.type}`);
});
// #endregion lifecycle-hooks

// ── #hook-error ───────────────────────────────────────────────────────────────

// #region hook-error
const errorRouter = new WorkflowRouter(taskWorkflow, undefined, {
	onHookError: (err) => myLogger.warn("Hook error:", err),
});
// #endregion hook-error

// ── #define-plugin ────────────────────────────────────────────────────────────

// type used to bind the plugin to this workflow's config
type TaskRouterConfig = ConfigOf<WorkflowRouter<typeof taskWorkflow.config>>;

// #region define-plugin
// biome-ignore lint/complexity/noBannedTypes: {} means "no deps", matching the router default
const loggingPlugin = definePlugin<TaskRouterConfig, {}>((router) => {
	router.on("pipeline:start", ({ command }) => {
		console.log(`[${new Date().toISOString()}] → ${command.type}`);
	});
	router.on("pipeline:end", (_ctx, result) => {
		console.log(`[${new Date().toISOString()}] ← ${result.ok ? "ok" : "error"}`);
	});
});
// #endregion define-plugin

// ── #use-plugin ───────────────────────────────────────────────────────────────

// #region use-plugin
const pluginRouter = new WorkflowRouter(taskWorkflow);
pluginRouter.use(loggingPlugin);
// #endregion use-plugin

// ── #plugin-middleware ────────────────────────────────────────────────────────

// #region plugin-middleware
const authPlugin = definePlugin((router) => {
	// Middleware: runs in the dispatch pipeline
	router.use(async ({ deps }, next) => {
		if (!(deps as Record<string, unknown>).currentUser) throw new Error("Unauthorized");
		await next();
	});

	// Hook: observes after the fact
	router.on("pipeline:end", ({ command }, result) => {
		auditLog.record(command, result);
	});
});
// #endregion plugin-middleware

void router;
void errorRouter;
void pluginRouter;
void authPlugin;
