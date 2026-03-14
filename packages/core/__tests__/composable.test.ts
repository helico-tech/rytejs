import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "../src/index.js";

const definition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional() }),
		Review: z.object({ title: z.string(), reviewer: z.string() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		SetTitle: z.object({ title: z.string() }),
		Submit: z.object({ reviewer: z.string() }),
		Approve: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		TitleSet: z.object({ title: z.string() }),
		Submitted: z.object({ id: z.string() }),
		Approved: z.object({ id: z.string() }),
	},
	errors: {
		TitleRequired: z.object({}),
	},
});

const wf = {
	Draft: (data: { title?: string } = {}) =>
		definition.createWorkflow("wf-1", { initialState: "Draft", data }),
	Review: (data: { title: string; reviewer: string }) =>
		definition.createWorkflow("wf-1", { initialState: "Review", data }),
};

describe("Composable Routers", () => {
	test("child router's handlers are callable through parent", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const result = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "Hello" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Draft");
		if (result.workflow.state === "Draft") {
			expect(result.workflow.data.title).toBe("Hello");
		}
	});

	test("definition mismatch throws", () => {
		const other = defineWorkflow("other", {
			states: { A: z.object({}) },
			commands: { Do: z.object({}) },
			events: {},
			errors: {},
		});
		const child = new WorkflowRouter(other);
		const parent = new WorkflowRouter(definition);
		// biome-ignore lint/suspicious/noExplicitAny: intentionally passing mismatched router to test runtime validation
		expect(() => parent.use(child as any)).toThrow("definition mismatch");
	});

	test("parent wins: parent handler takes priority over child", async () => {
		const log: string[] = [];
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", () => {
				log.push("child");
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.state("Draft", (s) => {
			s.on("SetTitle", () => {
				log.push("parent");
			});
		});
		parent.use(child);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent"]);
	});

	test("eager: mutations to child after .use() do not affect parent", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: "from-child" });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		// Mutate child after merge
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: "mutated" });
			});
		});

		const result = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "x" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		if (result.workflow.state === "Draft") {
			expect(result.workflow.data.title).toBe("from-child");
		}
	});

	test("child can be .use()'d into multiple parents", async () => {
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent1 = new WorkflowRouter(definition);
		parent1.use(child);

		const parent2 = new WorkflowRouter(definition);
		parent2.use(child);

		const r1 = await parent1.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "p1" },
		});
		const r2 = await parent2.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "p2" },
		});
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(true);
		if (r1.ok && r1.workflow.state === "Draft") expect(r1.workflow.data.title).toBe("p1");
		if (r2.ok && r2.workflow.state === "Draft") expect(r2.workflow.data.title).toBe("p2");
	});

	test("child global middleware runs after parent global middleware", async () => {
		const log: string[] = [];
		const child = new WorkflowRouter(definition);
		child.use(async (_ctx, next) => {
			log.push("child-global");
			await next();
		});
		child.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				log.push("handler");
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(async (_ctx, next) => {
			log.push("parent-global");
			await next();
		});
		parent.use(child);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent-global", "child-global", "handler"]);
	});

	test("child state middleware appended after parent state middleware", async () => {
		const log: string[] = [];
		const child = new WorkflowRouter(definition);
		child.state("Draft", (s) => {
			s.use(async (_ctx, next) => {
				log.push("child-state");
				await next();
			});
			s.on("SetTitle", (ctx) => {
				log.push("handler");
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.state("Draft", (s) => {
			s.use(async (_ctx, next) => {
				log.push("parent-state");
				await next();
			});
		});
		parent.use(child);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent-state", "child-state", "handler"]);
	});

	test("wildcard handlers from child are merged", async () => {
		const child = new WorkflowRouter(definition);
		child.on("*", "Archive", (ctx) => {
			ctx.transition("Archived", { reason: ctx.command.payload.reason });
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const result = await parent.dispatch(wf.Draft(), {
			type: "Archive",
			payload: { reason: "done" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.workflow.state).toBe("Archived");
	});

	test("multi-state handlers from child are merged", async () => {
		const child = new WorkflowRouter(definition);
		child.state(["Draft", "Review"] as const, (s) => {
			s.on("Archive", (ctx) => {
				ctx.transition("Archived", { reason: ctx.command.payload.reason });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(child);

		const r1 = await parent.dispatch(wf.Draft(), {
			type: "Archive",
			payload: { reason: "x" },
		});
		expect(r1.ok).toBe(true);
		if (r1.ok) expect(r1.workflow.state).toBe("Archived");

		const r2 = await parent.dispatch(wf.Review({ title: "T", reviewer: "r" }), {
			type: "Archive",
			payload: { reason: "y" },
		});
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.workflow.state).toBe("Archived");
	});

	test("nested composition: router.use(a) where a.use(b)", async () => {
		const b = new WorkflowRouter(definition);
		b.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const a = new WorkflowRouter(definition);
		a.use(b);

		const parent = new WorkflowRouter(definition);
		parent.use(a);

		const result = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "nested" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		if (result.workflow.state === "Draft") {
			expect(result.workflow.data.title).toBe("nested");
		}
	});

	test("multiple children can be composed into one parent", async () => {
		const draftRouter = new WorkflowRouter(definition);
		draftRouter.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const reviewRouter = new WorkflowRouter(definition);
		reviewRouter.state("Review", (s) => {
			s.on("Approve", (ctx) => {
				ctx.transition("Published", {
					title: ctx.data.title,
					publishedAt: new Date(),
				});
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(draftRouter);
		parent.use(reviewRouter);

		const r1 = await parent.dispatch(wf.Draft(), {
			type: "SetTitle",
			payload: { title: "composed" },
		});
		expect(r1.ok).toBe(true);

		const r2 = await parent.dispatch(wf.Review({ title: "T", reviewer: "r" }), {
			type: "Approve",
			payload: {},
		});
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.workflow.state).toBe("Published");
	});

	test("multiple children global middleware runs in .use() order", async () => {
		const log: string[] = [];
		const childA = new WorkflowRouter(definition);
		childA.use(async (_ctx, next) => {
			log.push("A");
			await next();
		});

		const childB = new WorkflowRouter(definition);
		childB.use(async (_ctx, next) => {
			log.push("B");
			await next();
		});
		childB.state("Draft", (s) => {
			s.on("SetTitle", (ctx) => {
				log.push("handler");
				ctx.update({ title: ctx.command.payload.title });
			});
		});

		const parent = new WorkflowRouter(definition);
		parent.use(async (_ctx, next) => {
			log.push("parent");
			await next();
		});
		parent.use(childA);
		parent.use(childB);

		await parent.dispatch(wf.Draft(), { type: "SetTitle", payload: { title: "x" } });
		expect(log).toEqual(["parent", "A", "B", "handler"]);
	});
});
