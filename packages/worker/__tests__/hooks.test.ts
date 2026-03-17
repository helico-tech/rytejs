import { describe, expect, test, vi } from "vitest";
import { createWorkerHooks } from "../src/hooks.js";
import { defineWorkerPlugin, isWorkerPlugin } from "../src/plugin.js";

describe("WorkerHooks", () => {
	test("emits events to registered callbacks", () => {
		const hooks = createWorkerHooks();
		const cb = vi.fn();
		hooks.on("worker:started", cb);
		hooks.emit("worker:started", {});
		expect(cb).toHaveBeenCalledWith({});
	});

	test("supports multiple callbacks per event", () => {
		const hooks = createWorkerHooks();
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		hooks.on("command:started", cb1);
		hooks.on("command:started", cb2);
		// biome-ignore lint/suspicious/noExplicitAny: test payload — shape doesn't matter here
		const payload = { workflowId: "wf-1", message: {} as any };
		hooks.emit("command:started", payload);
		expect(cb1).toHaveBeenCalledWith(payload);
		expect(cb2).toHaveBeenCalledWith(payload);
	});

	test("callback errors are caught and do not propagate", () => {
		const hooks = createWorkerHooks();
		hooks.on("worker:started", () => {
			throw new Error("hook error");
		});
		expect(() => hooks.emit("worker:started", {})).not.toThrow();
	});

	test("no-op when emitting event with no listeners", () => {
		const hooks = createWorkerHooks();
		expect(() => hooks.emit("worker:stopped", {})).not.toThrow();
	});
});

describe("defineWorkerPlugin", () => {
	test("creates a branded plugin function", () => {
		const plugin = defineWorkerPlugin((_hooks) => {});
		expect(isWorkerPlugin(plugin)).toBe(true);
	});

	test("non-plugin functions are not branded", () => {
		expect(isWorkerPlugin(() => {})).toBe(false);
		expect(isWorkerPlugin(42)).toBe(false);
		expect(isWorkerPlugin(null)).toBe(false);
	});

	test("plugin receives hook registry on apply", () => {
		const hooks = createWorkerHooks();
		const cb = vi.fn();
		const plugin = defineWorkerPlugin((h) => {
			h.on("worker:started", cb);
		});
		plugin(hooks);
		hooks.emit("worker:started", {});
		expect(cb).toHaveBeenCalled();
	});
});
