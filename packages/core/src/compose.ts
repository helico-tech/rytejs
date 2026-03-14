type Middleware<TCtx> = (ctx: TCtx, next: () => Promise<void>) => Promise<void>;

/** Composes an array of middleware into a single function (Koa-style onion model). */
export function compose<TCtx>(middleware: Middleware<TCtx>[]): (ctx: TCtx) => Promise<void> {
	return async (ctx: TCtx) => {
		let index = -1;
		async function dispatch(i: number): Promise<void> {
			if (i <= index) throw new Error("next() called multiple times");
			index = i;
			const fn = middleware[i];
			if (!fn) return;
			await fn(ctx, () => dispatch(i + 1));
		}
		await dispatch(0);
	};
}
