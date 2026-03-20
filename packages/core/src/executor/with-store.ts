import { ConcurrencyConflictError } from "../store/errors.js";
import type { StoreAdapter } from "../store/types.js";
import type { ExecutorMiddleware } from "./types.js";

export function withStore(store: StoreAdapter): ExecutorMiddleware {
	return async (ctx, next) => {
		if (ctx.operation === "execute") {
			const stored = await store.load(ctx.id);
			if (!stored) {
				ctx.result = {
					ok: false as const,
					error: { category: "not_found" as const, id: ctx.id },
				};
				return;
			}
			ctx.stored = stored;

			if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== stored.version) {
				ctx.result = {
					ok: false as const,
					error: {
						category: "conflict" as const,
						id: ctx.id,
						expectedVersion: ctx.expectedVersion,
						actualVersion: stored.version,
					},
				};
				return;
			}
		} else {
			const existing = await store.load(ctx.id);
			if (existing) {
				ctx.result = {
					ok: false as const,
					error: { category: "already_exists" as const, id: ctx.id },
				};
				return;
			}
		}

		await next();

		if (ctx.snapshot) {
			try {
				await store.save({
					id: ctx.id,
					snapshot: ctx.snapshot,
					expectedVersion: ctx.stored?.version ?? 0,
					events: ctx.events,
				});
				ctx.version = (ctx.stored?.version ?? 0) + 1;
			} catch (err) {
				if (err instanceof ConcurrencyConflictError) {
					ctx.result = {
						ok: false as const,
						error: {
							category: "conflict" as const,
							id: ctx.id,
							expectedVersion: ctx.stored?.version ?? 0,
							actualVersion: -1,
						},
					};
					ctx.snapshot = null;
					return;
				}
				throw err;
			}
		}
	};
}
