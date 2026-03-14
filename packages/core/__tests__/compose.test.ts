import { describe, expect, test } from "vitest";
import { compose } from "../src/compose.js";

type TestCtx = { log: string[] };

describe("compose", () => {
	test("executes middleware in onion order", async () => {
		const ctx: TestCtx = { log: [] };
		const fn = compose<TestCtx>([
			async (ctx, next) => {
				ctx.log.push("a-before");
				await next();
				ctx.log.push("a-after");
			},
			async (ctx, next) => {
				ctx.log.push("b-before");
				await next();
				ctx.log.push("b-after");
			},
		]);

		await fn(ctx);
		expect(ctx.log).toEqual(["a-before", "b-before", "b-after", "a-after"]);
	});

	test("empty middleware array completes without error", async () => {
		const ctx: TestCtx = { log: [] };
		const fn = compose<TestCtx>([]);
		await fn(ctx);
		expect(ctx.log).toEqual([]);
	});

	test("throws if next() called multiple times", async () => {
		const ctx: TestCtx = { log: [] };
		const fn = compose<TestCtx>([
			async (_ctx, next) => {
				await next();
				await next();
			},
		]);

		await expect(fn(ctx)).rejects.toThrow("next() called multiple times");
	});

	test("error in middleware propagates", async () => {
		const ctx: TestCtx = { log: [] };
		const fn = compose<TestCtx>([
			async (_ctx, _next) => {
				throw new Error("middleware error");
			},
		]);

		await expect(fn(ctx)).rejects.toThrow("middleware error");
	});

	test("downstream middleware can catch errors from upstream", async () => {
		const ctx: TestCtx = { log: [] };
		const fn = compose<TestCtx>([
			async (ctx, next) => {
				try {
					await next();
				} catch {
					ctx.log.push("caught");
				}
			},
			async (_ctx, _next) => {
				throw new Error("boom");
			},
		]);

		await fn(ctx);
		expect(ctx.log).toEqual(["caught"]);
	});
});
