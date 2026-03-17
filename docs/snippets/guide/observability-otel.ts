import { WorkflowRouter } from "@rytejs/core";
import { createOtelPlugin } from "@rytejs/otel";
import { taskWorkflow } from "../fixtures.js";

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

void router;
void customRouter;
