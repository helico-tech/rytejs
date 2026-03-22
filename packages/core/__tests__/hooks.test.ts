import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { HookRegistry } from "../src/hooks.js";
import { WorkflowRouter } from "../src/router.js";

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

const definition = defineWorkflow("hook-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
		Update: z.object({ title: z.string() }),
	},
	events: {
		Published: z.object({ id: z.string() }),
	},
	errors: {
		TitleRequired: z.object({}),
	},
});

describe("router hook integration", () => {
	test("pipeline:start fires before handler", async () => {
		const order: string[] = [];
		const router = new WorkflowRouter(definition);
		router.on("pipeline:start", () => {
			order.push("hook:start");
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				order.push("handler");
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(order).toEqual(["hook:start", "handler"]);
	});

	test("pipeline:end fires after handler with result", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.on("pipeline:end", (_ctx, result) => {
			capturedResult = result;
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(capturedResult).toEqual(result);
	});

	test("transition hook fires on state change", async () => {
		let captured: { from: string; to: string } | undefined;
		const router = new WorkflowRouter(definition);
		router.on("transition", (from, to, _workflow) => {
			captured = { from, to };
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(captured).toEqual({ from: "Draft", to: "Published" });
	});

	test("transition hook does not fire on in-place update", async () => {
		const transitionHook = vi.fn();
		const router = new WorkflowRouter(definition);
		router.on("transition", transitionHook);
		router.state("Draft", (state) => {
			state.on("Update", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Update", payload: { title: "Hello" } });
		expect(transitionHook).not.toHaveBeenCalled();
	});

	test("event hook fires for each emitted event", async () => {
		const events: unknown[] = [];
		const router = new WorkflowRouter(definition);
		router.on("event", (event, _workflow) => {
			events.push(event);
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", {
					title: ctx.command.payload.title,
					publishedAt: new Date(),
				});
				ctx.emit({ type: "Published", data: { id: ctx.workflow.id } });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(events).toEqual([{ type: "Published", data: { id: "wf-1" } }]);
	});

	test("error hook fires on domain error", async () => {
		let capturedError: unknown;
		const router = new WorkflowRouter(definition);
		router.on("error", (error, _ctx) => {
			capturedError = error;
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.error({ code: "TitleRequired", data: {} });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(capturedError).toEqual(result.error);
		}
	});

	test("hook errors are forwarded to onHookError", async () => {
		const errors: unknown[] = [];
		const router = new WorkflowRouter(definition, {}, { onHookError: (err) => errors.push(err) });
		const hookError = new Error("hook broke");
		router.on("pipeline:start", () => {
			throw hookError;
		});
		router.state("Draft", (state) => {
			state.on("Update", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Update",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true);
		expect(errors).toEqual([hookError]);
	});

	test("pipeline hooks do not fire on early validation/routing errors", async () => {
		const startHook = vi.fn();
		const router = new WorkflowRouter(definition);
		router.on("pipeline:start", startHook);

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(false);
		expect(startHook).not.toHaveBeenCalled();
	});

	test("dispatch:start fires before validation", async () => {
		let captured: { workflow: unknown; command: unknown } | undefined;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:start", (workflow, command) => {
			captured = { workflow, command };
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(captured).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		expect(captured!.workflow).toBe(wf);
		// biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined check above
		expect(captured!.command).toEqual({ type: "Publish", payload: { title: "Hello" } });
	});

	test("dispatch:end fires after early return (NO_HANDLER)", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:end", (_workflow, _command, result) => {
			capturedResult = result;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(capturedResult).toEqual(result);
		expect(result.ok).toBe(false);
	});

	test("dispatch:end fires after early return (UNKNOWN_STATE)", async () => {
		let hookFired = false;
		const router = new WorkflowRouter(definition);
		router.on("dispatch:end", () => {
			hookFired = true;
		});

		const badWf = {
			id: "x",
			definitionName: "hook-test",
			state: "nonexistent",
			data: {},
			createdAt: new Date(),
			updatedAt: new Date(),
			// biome-ignore lint/suspicious/noExplicitAny: intentionally creating invalid workflow
		} as any;
		await router.dispatch(badWf, { type: "Publish", payload: { title: "Hello" } });
		expect(hookFired).toBe(true);
	});

	test("dispatch:end fires after early return (command validation)", async () => {
		let hookFired = false;
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});
		router.on("dispatch:end", () => {
			hookFired = true;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid payload
		await router.dispatch(wf, { type: "Publish", payload: {} as any });
		expect(hookFired).toBe(true);
	});

	test("dispatch:end fires after successful pipeline", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});
		router.on("dispatch:end", (_workflow, _command, result) => {
			capturedResult = result;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(capturedResult).toEqual(result);
		expect(result.ok).toBe(true);
	});

	test("dispatch:end fires after pipeline errors (unexpected)", async () => {
		let capturedResult: unknown;
		const router = new WorkflowRouter(definition);
		router.state("Draft", (state) => {
			state.on("Publish", () => {
				throw new Error("boom");
			});
		});
		router.on("dispatch:end", (_workflow, _command, result) => {
			capturedResult = result;
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(capturedResult).toEqual(result);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.category).toBe("unexpected");
	});

	test("dispatch:start fires before pipeline:start", async () => {
		const order: string[] = [];
		const router = new WorkflowRouter(definition);
		router.on("dispatch:start", (_wf, _cmd) => order.push("dispatch:start"));
		router.on("pipeline:start", (_ctx) => order.push("pipeline:start"));
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(order).toEqual(["dispatch:start", "pipeline:start"]);
	});

	test("pipeline:end fires before dispatch:end", async () => {
		const order: string[] = [];
		const router = new WorkflowRouter(definition);
		router.on("pipeline:end", (_ctx, _result) => order.push("pipeline:end"));
		router.on("dispatch:end", (_wf, _cmd, _result) => order.push("dispatch:end"));
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title, publishedAt: new Date() });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(order).toEqual(["pipeline:end", "dispatch:end"]);
	});
});
