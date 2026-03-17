import { describe, expect, test } from "vitest";
import { calculateDelay, resolveBackoff } from "../src/backoff.js";

describe("resolveBackoff", () => {
	test("resolves 'exponential' shorthand", () => {
		expect(resolveBackoff("exponential")).toEqual({
			strategy: "exponential",
			base: 1_000,
			max: 30_000,
		});
	});

	test("resolves 'fixed' shorthand", () => {
		expect(resolveBackoff("fixed")).toEqual({
			strategy: "fixed",
			delay: 1_000,
		});
	});

	test("resolves 'linear' shorthand", () => {
		expect(resolveBackoff("linear")).toEqual({
			strategy: "linear",
			delay: 1_000,
			max: 30_000,
		});
	});

	test("passes through full config", () => {
		const config = { strategy: "fixed" as const, delay: 500 };
		expect(resolveBackoff(config)).toEqual(config);
	});
});

describe("calculateDelay", () => {
	test("fixed returns constant delay", () => {
		expect(calculateDelay({ strategy: "fixed", delay: 500 }, 0)).toBe(500);
		expect(calculateDelay({ strategy: "fixed", delay: 500 }, 3)).toBe(500);
	});

	test("exponential doubles each attempt, capped at max", () => {
		const config = {
			strategy: "exponential" as const,
			base: 1_000,
			max: 10_000,
		};
		expect(calculateDelay(config, 0)).toBe(1_000);
		expect(calculateDelay(config, 1)).toBe(2_000);
		expect(calculateDelay(config, 2)).toBe(4_000);
		expect(calculateDelay(config, 3)).toBe(8_000);
		expect(calculateDelay(config, 4)).toBe(10_000); // capped
	});

	test("linear multiplies by attempt, capped at max", () => {
		const config = { strategy: "linear" as const, delay: 1_000, max: 5_000 };
		expect(calculateDelay(config, 0)).toBe(0); // 1000 * 0
		expect(calculateDelay(config, 1)).toBe(1_000);
		expect(calculateDelay(config, 2)).toBe(2_000);
		expect(calculateDelay(config, 5)).toBe(5_000); // capped
		expect(calculateDelay(config, 10)).toBe(5_000); // still capped
	});
});
