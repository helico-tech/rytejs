import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { definePlugin, isPlugin } from "../src/plugin.js";
import { WorkflowRouter } from "../src/router.js";

const definition = defineWorkflow("plugin-test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Published: z.object({ title: z.string() }),
	},
	commands: {
		Publish: z.object({ title: z.string() }),
	},
	events: {
		Published: z.object({ id: z.string() }),
	},
	errors: {},
});

describe("definePlugin / isPlugin", () => {
	test("definePlugin brands a function", () => {
		const plugin = definePlugin(() => {});
		expect(isPlugin(plugin)).toBe(true);
	});

	test("plain functions are not plugins", () => {
		const fn = () => {};
		expect(isPlugin(fn)).toBe(false);
	});

	test("non-functions are not plugins", () => {
		expect(isPlugin(42)).toBe(false);
		expect(isPlugin(null)).toBe(false);
		expect(isPlugin("string")).toBe(false);
	});
});

describe("router.use() with plugins", () => {
	test("plugin receives the router and can register hooks", async () => {
		const log: string[] = [];
		const loggingPlugin = definePlugin<typeof definition.config, Record<string, never>>(
			(router) => {
				router.on("pipeline:start", () => {
					log.push("plugin:start");
				});
				router.on("pipeline:end", () => {
					log.push("plugin:end");
				});
			},
		);

		const router = new WorkflowRouter(definition);
		router.use(loggingPlugin);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(log).toEqual(["plugin:start", "plugin:end"]);
	});

	test("plugin can register middleware", async () => {
		const log: string[] = [];
		const authPlugin = definePlugin<typeof definition.config, Record<string, never>>((router) => {
			router.use(async (_ctx, next) => {
				log.push("auth-middleware");
				await next();
			});
		});

		const router = new WorkflowRouter(definition);
		router.use(authPlugin);
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				log.push("handler");
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(log).toEqual(["auth-middleware", "handler"]);
	});

	test("use() still works with plain middleware", async () => {
		const log: string[] = [];
		const router = new WorkflowRouter(definition);
		router.use(async (_ctx, next) => {
			log.push("global");
			await next();
		});
		router.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				log.push("handler");
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		await router.dispatch(wf, { type: "Publish", payload: { title: "Hello" } });
		expect(log).toEqual(["global", "handler"]);
	});

	test("use() still works with composable routers", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (state) => {
			state.on("Publish", (ctx) => {
				ctx.transition("Published", { title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const wf = definition.createWorkflow("wf-1", { initialState: "Draft", data: {} });
		const result = await parent.dispatch(wf, {
			type: "Publish",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true);
	});
});
