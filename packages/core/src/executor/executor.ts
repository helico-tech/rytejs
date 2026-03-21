import { compose } from "../compose.js";
import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import { ConcurrencyConflictError } from "../store/errors.js";
import type { StoreAdapter } from "../store/types.js";
import type { WorkflowConfig } from "../types.js";
import type { ExecutionResult, ExecutorContext, ExecutorMiddleware } from "./types.js";

export class WorkflowExecutor<TConfig extends WorkflowConfig> {
	private readonly middleware: ExecutorMiddleware[] = [];

	constructor(
		public readonly router: WorkflowRouter<TConfig>,
		private readonly store: StoreAdapter,
	) {}

	use(middleware: ExecutorMiddleware): this {
		this.middleware.push(middleware);
		return this;
	}

	async execute(
		id: string,
		command: { type: string; payload: unknown },
		options?: { expectedVersion?: number },
	): Promise<ExecutionResult> {
		// 1. Load
		const stored = await this.store.load(id);
		if (!stored) {
			return { ok: false, error: { category: "not_found", id } };
		}

		// 2. Optimistic version check
		if (options?.expectedVersion !== undefined && options.expectedVersion !== stored.version) {
			return {
				ok: false,
				error: {
					category: "conflict",
					id,
					expectedVersion: options.expectedVersion,
					actualVersion: stored.version,
				},
			};
		}

		// 3. Build context
		const ctx: ExecutorContext = {
			id,
			command,
			stored,
			result: null,
			snapshot: null,
			events: [],
		};

		// 4. Run pipeline
		try {
			const chain = [...this.middleware, this.dispatchHandler()];
			await compose(chain)(ctx);
		} catch (err) {
			return {
				ok: false,
				error: {
					category: "unexpected",
					error: err,
					message: err instanceof Error ? err.message : String(err),
				},
			};
		}

		// 5. Save if dispatch succeeded
		if (ctx.snapshot) {
			const newVersion = stored.version + 1;
			const savedSnapshot = { ...ctx.snapshot, version: newVersion };

			try {
				await this.store.save({
					id,
					snapshot: ctx.snapshot,
					expectedVersion: stored.version,
					events: ctx.events,
				});
			} catch (err) {
				if (err instanceof ConcurrencyConflictError) {
					return {
						ok: false,
						error: {
							category: "conflict",
							id,
							expectedVersion: stored.version,
							actualVersion: err.actualVersion,
						},
					};
				}
				return {
					ok: false,
					error: {
						category: "unexpected",
						error: err,
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}

			return {
				ok: true,
				snapshot: savedSnapshot,
				version: newVersion,
				events: ctx.events,
			};
		}

		// 6. Dispatch failed — return the error
		if (ctx.result && !ctx.result.ok) {
			return { ok: false, error: ctx.result.error };
		}

		return {
			ok: false,
			error: {
				category: "unexpected",
				error: new Error("Pipeline completed without setting snapshot or error"),
				message: "Pipeline completed without setting snapshot or error",
			},
		};
	}

	private dispatchHandler(): ExecutorMiddleware {
		const definition = this.router.definition;
		const router = this.router;

		return async (ctx, _next) => {
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
}
