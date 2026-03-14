import { describe, expect, test, vi } from "vitest";
import { HookRegistry } from "../src/hooks.js";

describe("HookRegistry", () => {
	test("registers and emits a hook", async () => {
		const registry = new HookRegistry();
		const callback = vi.fn();
		registry.add("dispatch:start", callback);

		await registry.emit("dispatch:start", console.error, "arg1", "arg2");
		expect(callback).toHaveBeenCalledWith("arg1", "arg2");
	});

	test("multiple callbacks run in registration order", async () => {
		const registry = new HookRegistry();
		const order: number[] = [];
		registry.add("dispatch:start", () => order.push(1));
		registry.add("dispatch:start", () => order.push(2));
		registry.add("dispatch:start", () => order.push(3));

		await registry.emit("dispatch:start", console.error);
		expect(order).toEqual([1, 2, 3]);
	});

	test("hook errors are caught and forwarded to onError", async () => {
		const registry = new HookRegistry();
		const onError = vi.fn();
		const error = new Error("hook failed");
		registry.add("dispatch:start", () => {
			throw error;
		});
		registry.add("dispatch:start", vi.fn());

		await registry.emit("dispatch:start", onError);
		expect(onError).toHaveBeenCalledWith(error);
	});

	test("hook errors do not prevent other hooks from running", async () => {
		const registry = new HookRegistry();
		const onError = vi.fn();
		const second = vi.fn();
		registry.add("dispatch:start", () => {
			throw new Error("fail");
		});
		registry.add("dispatch:start", second);

		await registry.emit("dispatch:start", onError);
		expect(second).toHaveBeenCalled();
	});

	test("async hooks are awaited", async () => {
		const registry = new HookRegistry();
		const order: number[] = [];
		registry.add("dispatch:start", async () => {
			await new Promise((r) => setTimeout(r, 10));
			order.push(1);
		});
		registry.add("dispatch:start", () => order.push(2));

		await registry.emit("dispatch:start", console.error);
		expect(order).toEqual([1, 2]);
	});

	test("emitting unregistered hook does nothing", async () => {
		const registry = new HookRegistry();
		await registry.emit("dispatch:end", console.error);
	});

	test("merge copies hooks from another registry", async () => {
		const parent = new HookRegistry();
		const child = new HookRegistry();
		const callback = vi.fn();
		child.add("transition", callback);

		parent.merge(child);

		await parent.emit("transition", console.error, "a", "b", {});
		expect(callback).toHaveBeenCalledWith("a", "b", {});
	});
});
