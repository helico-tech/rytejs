import { WorkflowRouter } from "@rytejs/core";
import { WorkflowExecutor } from "@rytejs/core/executor";
import { createOtelExecutorMiddleware, createOtelPlugin } from "@rytejs/otel";
import { taskRouter, taskWorkflow } from "../fixtures.js";

// #region install
const router = new WorkflowRouter(taskWorkflow);
router.use(createOtelPlugin());
// #endregion install

// #region custom
declare const trace: { getTracer(name: string): unknown };
declare const metrics: { getMeter(name: string): unknown };

const customRouter = new WorkflowRouter(taskWorkflow);
customRouter.use(
	createOtelPlugin({
		// biome-ignore lint/suspicious/noExplicitAny: external OTel Tracer type
		tracer: trace.getTracer("my-service") as any,
		// biome-ignore lint/suspicious/noExplicitAny: external OTel Meter type
		meter: metrics.getMeter("my-service") as any,
	}),
);
// #endregion custom

// #region executor-plugin
const executor = new WorkflowExecutor(taskRouter);
executor.use(createOtelExecutorMiddleware());

// Traces executor operations:
// - ryte.execute.{commandType} spans for execute()
// - Attributes: ryte.workflow.id, ryte.command.type
// #endregion executor-plugin

// #region full-stack-tracing
// Router-level: dispatch spans, transition events, metrics
const tracedRouter = new WorkflowRouter(taskWorkflow);
tracedRouter.use(createOtelPlugin());

// Executor-level: operation spans wrapping the router dispatch
const tracedExecutor = new WorkflowExecutor(tracedRouter);
tracedExecutor.use(createOtelExecutorMiddleware());

// End-to-end: executor span → router dispatch span → handler
// #endregion full-stack-tracing

void router;
void customRouter;
void executor;
void tracedRouter;
void tracedExecutor;
