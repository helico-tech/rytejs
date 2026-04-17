import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { defineWorkflow, WorkflowRouter } from "../src/index.js";

describe("Standard Schema validator interop", () => {
	test("Valibot schemas drive a workflow end-to-end", async () => {
		const def = defineWorkflow("counter", {
			states: {
				Idle: v.object({ count: v.number() }),
				Running: v.object({ count: v.number(), startedAt: v.date() }),
			},
			commands: {
				Start: v.object({}),
				Increment: v.object({ by: v.number() }),
			},
			events: {
				Started: v.object({ at: v.date() }),
				Incremented: v.object({ to: v.number() }),
			},
			errors: {
				CannotIncrement: v.object({ reason: v.string() }),
			},
		});

		const router = new WorkflowRouter(def)
			.state("Idle", ({ on }) => {
				on("Start", ({ data, transition, emit }) => {
					const now = new Date();
					transition("Running", { count: data.count, startedAt: now });
					emit("Started", { at: now });
				});
			})
			.state("Running", ({ on }) => {
				on("Increment", ({ data, command, update, emit }) => {
					const next = data.count + command.payload.by;
					update({ ...data, count: next });
					emit("Incremented", { to: next });
				});
			});

		const wf = def.createWorkflow("c1", { initialState: "Idle", data: { count: 0 } });
		const started = await router.dispatch(wf, "Start", {});
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		expect(started.workflow.state).toBe("Running");

		const inc = await router.dispatch(started.workflow, "Increment", { by: 5 });
		expect(inc.ok).toBe(true);
		if (!inc.ok) return;
		expect(inc.workflow.data).toMatchObject({ count: 5 });
		expect(inc.events).toEqual([{ type: "Incremented", data: { to: 5 } }]);
	});

	test("Valibot validation failure surfaces as a validation PipelineError", async () => {
		const def = defineWorkflow("strict", {
			states: { S: v.object({ n: v.number() }) },
			commands: { C: v.object({ x: v.number() }) },
			events: {},
			errors: {},
		});

		const router = new WorkflowRouter(def).state("S", ({ on }) => {
			on("C", () => {
				/* no-op */
			});
		});

		const wf = def.createWorkflow("s1", { initialState: "S", data: { n: 0 } });
		const result = await router.dispatch(wf, "C", { x: "not-a-number" } as unknown as {
			x: number;
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("validation");
		if (result.error.category !== "validation") return;
		expect(result.error.source).toBe("command");
		expect(result.error.issues.length).toBeGreaterThan(0);
		expect(result.error.issues[0]?.message).toBeTruthy();
	});

	test("ArkType schemas drive a workflow end-to-end", async () => {
		const def = defineWorkflow("arktype-workflow", {
			states: {
				Draft: type({ title: "string" }),
				Published: type({ title: "string", publishedAt: "Date" }),
			},
			commands: {
				Publish: type({}),
			},
			events: {
				Published: type({ at: "Date" }),
			},
			errors: {},
		});

		const router = new WorkflowRouter(def).state("Draft", ({ on }) => {
			on("Publish", ({ data, transition, emit }) => {
				const now = new Date();
				transition("Published", { title: data.title, publishedAt: now });
				emit("Published", { at: now });
			});
		});

		const wf = def.createWorkflow("a1", {
			initialState: "Draft",
			data: { title: "Hello" },
		});
		const result = await router.dispatch(wf, "Publish", {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.workflow.state).toBe("Published");
		expect((result.workflow.data as { title: string }).title).toBe("Hello");
	});

	test("ArkType validation failure surfaces as a validation PipelineError", async () => {
		const def = defineWorkflow("arktype-strict", {
			states: { S: type({ n: "number" }) },
			commands: { C: type({ x: "number" }) },
			events: {},
			errors: {},
		});

		const router = new WorkflowRouter(def).state("S", ({ on }) => {
			on("C", () => {
				/* no-op */
			});
		});

		const wf = def.createWorkflow("ak1", { initialState: "S", data: { n: 0 } });
		const result = await router.dispatch(wf, "C", { x: "oops" } as unknown as { x: number });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.category).toBe("validation");
	});
});
