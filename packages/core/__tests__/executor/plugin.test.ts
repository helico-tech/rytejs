import { describe, expect, test, vi } from "vitest";
import { defineExecutorPlugin, isExecutorPlugin } from "../../src/executor/plugin.js";

describe("defineExecutorPlugin", () => {
	test("creates a branded plugin function", () => {
		const plugin = defineExecutorPlugin(() => {});
		expect(isExecutorPlugin(plugin)).toBe(true);
		expect(typeof plugin).toBe("function");
	});

	test("non-plugin values return false", () => {
		expect(isExecutorPlugin(() => {})).toBe(false);
		expect(isExecutorPlugin(null)).toBe(false);
		expect(isExecutorPlugin("string")).toBe(false);
	});

	test("plugin receives executor when called", () => {
		const fn = vi.fn();
		const plugin = defineExecutorPlugin(fn);
		const fakeExecutor = {} as never;
		plugin(fakeExecutor);
		expect(fn).toHaveBeenCalledWith(fakeExecutor);
	});
});
