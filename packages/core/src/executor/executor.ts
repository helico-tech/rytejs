import { compose } from "../compose.js";
import { HookRegistry } from "../hooks.js";
import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { WorkflowConfig } from "../types.js";
import { type ExecutorPlugin, isExecutorPlugin } from "./plugin.js";
import type {
	CreateContext,
	ExecuteContext,
	ExecutionResult,
	ExecutorContext,
	ExecutorMiddleware,
} from "./types.js";

type ExecutorHookEvent = "execute:start" | "execute:end";

export class WorkflowExecutor<TConfig extends WorkflowConfig> {
	private readonly middleware: ExecutorMiddleware[] = [];
	private readonly hookRegistry = new HookRegistry();
	private readonly onHookError: (error: unknown) => void;

	constructor(
		public readonly router: WorkflowRouter<TConfig>,
		options?: { onHookError?: (error: unknown) => void },
	) {
		this.onHookError = options?.onHookError ?? console.error;
	}

	use(arg: ExecutorMiddleware | ExecutorPlugin): this {
		if (isExecutorPlugin(arg)) {
			// biome-ignore lint/suspicious/noExplicitAny: plugin accepts any executor config
			(arg as any)(this);
		} else {
			this.middleware.push(arg);
		}
		return this;
	}

	on(event: ExecutorHookEvent, callback: (ctx: ExecutorContext) => void | Promise<void>): this {
		// biome-ignore lint/complexity/noBannedTypes: HookRegistry uses Function internally
		this.hookRegistry.add(event, callback as Function);
		return this;
	}

	async create(
		id: string,
		init: { initialState: string; data: unknown },
	): Promise<ExecutionResult> {
		const ctx: CreateContext = {
			operation: "create",
			id,
			init,
			stored: null,
			result: null,
			snapshot: null,
			version: 0,
			events: [],
		};
		return this.run(ctx);
	}

	async execute(id: string, command: { type: string; payload: unknown }): Promise<ExecutionResult> {
		const ctx: ExecuteContext = {
			operation: "execute",
			id,
			command,
			stored: null,
			result: null,
			snapshot: null,
			version: 0,
			events: [],
		};
		return this.run(ctx);
	}

	private async run(ctx: ExecutorContext): Promise<ExecutionResult> {
		await this.hookRegistry.emit("execute:start", this.onHookError, ctx);

		try {
			const chain = [...this.middleware, this.coreHandler()];
			await compose(chain)(ctx);
		} catch (err) {
			ctx.result = {
				ok: false as const,
				error: {
					category: "unexpected" as const,
					error: err,
					message: err instanceof Error ? err.message : String(err),
				},
			};
			ctx.snapshot = null;
		}

		await this.hookRegistry.emit("execute:end", this.onHookError, ctx);

		return this.toResult(ctx);
	}

	private coreHandler(): ExecutorMiddleware {
		const definition = this.router.definition;
		const router = this.router;

		return async (ctx, _next) => {
			if (ctx.operation === "create") {
				try {
					// as never: type erasure — executor holds WorkflowConfig base type,
					// but createWorkflow validates data against Zod schemas at runtime
					const workflow = definition.createWorkflow(ctx.id, {
						initialState: ctx.init.initialState,
						data: ctx.init.data,
					} as never);
					// biome-ignore lint/suspicious/noExplicitAny: type erasure — TConfig narrows WorkflowSnapshot but ctx.snapshot is unparameterized
					ctx.snapshot = definition.snapshot(workflow) as any as WorkflowSnapshot;
					ctx.events = [];
				} catch (err) {
					ctx.result = {
						ok: false as const,
						error: {
							category: "validation" as const,
							source: "command" as const,
							issues: [],
							message: err instanceof Error ? err.message : String(err),
						},
					};
				}
				return;
			}

			// execute
			if (!ctx.stored) {
				ctx.result = {
					ok: false as const,
					error: { category: "not_found" as const, id: ctx.id },
				};
				return;
			}

			const restoreResult = definition.restore(ctx.stored.snapshot);
			if (!restoreResult.ok) {
				ctx.result = {
					ok: false as const,
					error: {
						category: "restore" as const,
						id: ctx.id,
						issues: restoreResult.error.issues,
					},
				};
				return;
			}

			// as never: type erasure — executor holds WorkflowConfig base type,
			// but dispatch validates commands against Zod schemas at runtime
			const dispatchResult = await router.dispatch(restoreResult.workflow, ctx.command as never);

			// biome-ignore lint/suspicious/noExplicitAny: type erasure — DispatchResult<TConfig> assigned to DispatchResult<WorkflowConfig>
			ctx.result = dispatchResult as any;

			if (dispatchResult.ok) {
				// biome-ignore lint/suspicious/noExplicitAny: type erasure — TConfig narrows WorkflowSnapshot but ctx.snapshot is unparameterized
				ctx.snapshot = definition.snapshot(dispatchResult.workflow) as any as WorkflowSnapshot;
				ctx.events = (dispatchResult.events as Array<{ type: string; data: unknown }>).map((e) => ({
					type: e.type,
					data: e.data,
				}));
			}
		};
	}

	private toResult(ctx: ExecutorContext): ExecutionResult {
		if (ctx.snapshot) {
			return {
				ok: true,
				snapshot: ctx.snapshot,
				version: ctx.version,
				events: ctx.events,
			};
		}

		if (ctx.result && !ctx.result.ok) {
			return { ok: false, error: ctx.result.error };
		}

		return {
			ok: false,
			error: {
				category: "unexpected",
				error: new Error("Executor pipeline completed without setting snapshot or error"),
			},
		};
	}
}
