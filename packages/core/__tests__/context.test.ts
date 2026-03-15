import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createContext } from "../src/context.js";
import { defineWorkflow } from "../src/definition.js";
import { createKey } from "../src/key.js";
import { DomainErrorSignal, ValidationError } from "../src/types.js";

const definition = defineWorkflow("test", {
	states: {
		Draft: z.object({ title: z.string().optional(), body: z.string().optional() }),
		Review: z.object({ title: z.string(), body: z.string(), reviewer: z.string().optional() }),
		Published: z.object({ title: z.string(), publishedAt: z.coerce.date() }),
		Archived: z.object({ reason: z.string() }),
	},
	commands: {
		Save: z.object({ title: z.string() }),
		Submit: z.object({}),
	},
	events: {
		Saved: z.object({ id: z.string() }),
		Submitted: z.object({ id: z.string() }),
	},
	errors: {
		Incomplete: z.object({ missing: z.array(z.string()) }),
		AlreadyPublished: z.object({}),
	},
});

const create = {
	Draft: (data: { title?: string; body?: string } = {}) =>
		definition.createWorkflow("wf-1", { initialState: "Draft", data }),
	Review: (data: { title: string; body: string; reviewer?: string }) =>
		definition.createWorkflow("wf-1", { initialState: "Review", data }),
	Published: (data: { title: string; publishedAt: Date }) =>
		definition.createWorkflow("wf-1", { initialState: "Published", data }),
	Archived: (data: { reason: string }) =>
		definition.createWorkflow("wf-1", { initialState: "Archived", data }),
};

const deps = { db: "mock-db" };

describe("createContext", () => {
	describe("data and update", () => {
		test("ctx.data returns current state data", () => {
			const wf = create.Draft({ title: "hello" });
			const ctx = createContext(
				definition,
				wf,
				{ type: "Save", payload: { title: "hello" } },
				deps,
			);
			expect(ctx.data).toEqual({ title: "hello" });
		});

		test("ctx.update merges data into current state", () => {
			const wf = create.Draft({ title: "hello" });
			const ctx = createContext(
				definition,
				wf,
				{ type: "Save", payload: { title: "hello" } },
				deps,
			);
			ctx.update({ body: "world" });
			expect(ctx.data).toEqual({ title: "hello", body: "world" });
		});

		test("ctx.update validates against state schema", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid type to test validation
			expect(() => ctx.update({ title: 123 as any })).toThrow(ValidationError);
		});
	});

	describe("transition", () => {
		test("ctx.transition sets target state and data", () => {
			const wf = create.Draft({ title: "hello", body: "world" });
			const ctx = createContext(definition, wf, { type: "Submit", payload: {} }, deps);
			ctx.transition("Review", { title: "hello", body: "world" });
			const snapshot = ctx.getWorkflowSnapshot();
			expect(snapshot.state).toBe("Review");
			expect(snapshot.data).toEqual({ title: "hello", body: "world" });
		});

		test("ctx.transition validates data against target state schema", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Submit", payload: {} }, deps);
			// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid data to test validation
			expect(() => ctx.transition("Review", {} as any)).toThrow(ValidationError);
		});

		test("ctx.transition throws for unknown target state", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Submit", payload: {} }, deps);
			// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid state to test error
			expect(() => ctx.transition("nonexistent" as any, {})).toThrow("Unknown state: nonexistent");
		});

		test("transition discards prior ctx.update changes", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Submit", payload: {} }, deps);
			ctx.update({ title: "updated" });
			ctx.transition("Review", { title: "from-transition", body: "text" });
			const snapshot = ctx.getWorkflowSnapshot();
			expect(snapshot.state).toBe("Review");
			expect(snapshot.data).toEqual({ title: "from-transition", body: "text" });
		});
	});

	describe("emit", () => {
		test("ctx.emit accumulates events", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			ctx.emit({ type: "Saved", data: { id: "1" } });
			ctx.emit({ type: "Submitted", data: { id: "1" } });
			expect(ctx.events).toHaveLength(2);
			expect(ctx.events[0]).toEqual({ type: "Saved", data: { id: "1" } });
		});

		test("ctx.emit validates event data against schema", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid data to test validation
			expect(() => ctx.emit({ type: "Saved", data: {} as any })).toThrow();
		});

		test("ctx.events returns a copy (not mutable)", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			ctx.emit({ type: "Saved", data: { id: "1" } });
			const events1 = ctx.events;
			ctx.emit({ type: "Submitted", data: { id: "1" } });
			const events2 = ctx.events;
			expect(events1).toHaveLength(1);
			expect(events2).toHaveLength(2);
		});
	});

	describe("error", () => {
		test("ctx.error throws DomainErrorSignal", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			expect(() => ctx.error({ code: "Incomplete", data: { missing: ["body"] } })).toThrow(
				DomainErrorSignal,
			);
		});

		test("ctx.error validates error data against schema", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			expect(() =>
				// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid data to test validation
				ctx.error({ code: "Incomplete", data: { missing: "not-an-array" } as any }),
			).toThrow();
		});
	});

	describe("middleware state", () => {
		const RoleKey = createKey<string>("role");
		const CountKey = createKey<number>("count");

		test("set and get work with typed keys", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			ctx.set(RoleKey, "admin");
			expect(ctx.get(RoleKey)).toBe("admin");
		});

		test("get throws if key not set", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			expect(() => ctx.get(RoleKey)).toThrow();
		});

		test("getOrNull returns undefined if key not set", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			expect(ctx.getOrNull(RoleKey)).toBeUndefined();
		});

		test("getOrNull returns value if key is set", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			ctx.set(CountKey, 42);
			expect(ctx.getOrNull(CountKey)).toBe(42);
		});
	});

	describe("getWorkflowSnapshot", () => {
		test("returns updated workflow when no transition", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			ctx.update({ title: "updated" });
			const snapshot = ctx.getWorkflowSnapshot();
			expect(snapshot.state).toBe("Draft");
			expect(snapshot.data).toEqual({ title: "updated" });
			expect(snapshot.id).toBe("wf-1");
		});

		test("returns new workflow after transition", () => {
			const wf = create.Draft({ title: "hello", body: "world" });
			const ctx = createContext(definition, wf, { type: "Submit", payload: {} }, deps);
			ctx.transition("Review", { title: "hello", body: "world" });
			const snapshot = ctx.getWorkflowSnapshot();
			expect(snapshot.state).toBe("Review");
			expect(snapshot.data).toEqual({ title: "hello", body: "world" });
		});

		test("original workflow is not mutated", () => {
			const wf = create.Draft({ title: "original" });
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps);
			ctx.update({ title: "changed" });
			expect(wf.data).toEqual({ title: "original" });
		});
	});

	describe("deps", () => {
		test("ctx.deps exposes provided dependencies", () => {
			const wf = create.Draft();
			const ctx = createContext(definition, wf, { type: "Save", payload: { title: "x" } }, deps, {
				wrapDeps: false,
			});
			expect(ctx.deps).toBe(deps);
		});
	});

	describe("command", () => {
		test("ctx.command exposes type and payload", () => {
			const wf = create.Draft();
			const cmd = { type: "Save", payload: { title: "hello" } };
			const ctx = createContext(definition, wf, cmd, deps);
			expect(ctx.command.type).toBe("Save");
			expect(ctx.command.payload).toEqual({ title: "hello" });
		});
	});
});
