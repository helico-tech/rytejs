import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";

const definition = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
	},
	commands: {
		PlaceOrder: z.object({}),
	},
	events: {},
	errors: {},
});

describe("snapshot()", () => {
	test("produces a plain JSON-safe object", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["apple"] },
		});
		const snap = definition.snapshot(wf);

		expect(snap.id).toBe("wf-1");
		expect(snap.definitionName).toBe("order");
		expect(snap.state).toBe("Draft");
		expect(snap.data).toEqual({ items: ["apple"] });
		expect(typeof snap.createdAt).toBe("string");
		expect(typeof snap.updatedAt).toBe("string");
		expect(snap.modelVersion).toBe(1);
		expect(snap.version).toBe(1);
	});

	test("serializes dates as ISO 8601 strings", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const snap = definition.snapshot(wf);

		expect(new Date(snap.createdAt).toISOString()).toBe(snap.createdAt);
		expect(new Date(snap.updatedAt).toISOString()).toBe(snap.updatedAt);
	});

	test("snapshot is JSON.stringify safe", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["a", "b"] },
		});
		const snap = definition.snapshot(wf);
		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);

		expect(parsed).toEqual(snap);
	});

	test("snapshot of state with Date field serializes the Date", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Placed",
			data: { items: ["apple"], placedAt: new Date("2026-01-01T00:00:00.000Z") },
		});
		const snap = definition.snapshot(wf);

		expect(snap.state).toBe("Placed");
	});
});

describe("restore()", () => {
	test("restores a valid snapshot", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["apple"] },
		});
		const snap = definition.snapshot(wf);
		const result = definition.restore(snap);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.id).toBe("wf-1");
			expect(result.workflow.state).toBe("Draft");
			expect(result.workflow.data).toEqual({ items: ["apple"] });
			expect(result.workflow.createdAt).toBeInstanceOf(Date);
			expect(result.workflow.updatedAt).toBeInstanceOf(Date);
		}
	});

	test("restores dates from ISO strings", () => {
		const snap = {
			id: "wf-1",
			definitionName: "order",
			state: "Draft" as const,
			data: { items: [] },
			createdAt: "2026-01-15T10:00:00.000Z",
			updatedAt: "2026-01-15T10:05:00.000Z",
			modelVersion: 1,
			version: 1,
		};
		const result = definition.restore(snap);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.createdAt).toEqual(new Date("2026-01-15T10:00:00.000Z"));
			expect(result.workflow.updatedAt).toEqual(new Date("2026-01-15T10:05:00.000Z"));
		}
	});

	test("returns error for invalid state data", () => {
		const snap = {
			id: "wf-1",
			definitionName: "order",
			state: "Draft" as const,
			data: { items: "not-an-array" },
			createdAt: "2026-01-15T10:00:00.000Z",
			updatedAt: "2026-01-15T10:05:00.000Z",
			modelVersion: 1,
			version: 1,
		};
		const result = definition.restore(snap);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.source).toBe("restore");
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	test("returns error for unknown state", () => {
		const snap = {
			id: "wf-1",
			definitionName: "order",
			state: "Unknown" as any,
			data: {},
			createdAt: "2026-01-15T10:00:00.000Z",
			updatedAt: "2026-01-15T10:05:00.000Z",
			modelVersion: 1,
			version: 1,
		};
		const result = definition.restore(snap);

		expect(result.ok).toBe(false);
	});

	test("round-trips through JSON", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: ["apple", "banana"] },
		});
		const snap = definition.snapshot(wf);
		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		const result = definition.restore(parsed);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.id).toBe("wf-1");
			expect(result.workflow.state).toBe("Draft");
			expect(result.workflow.data).toEqual({ items: ["apple", "banana"] });
		}
	});
});

describe("modelVersion", () => {
	test("modelVersion defaults to 1", () => {
		const wf = definition.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const snap = definition.snapshot(wf);
		expect(snap.modelVersion).toBe(1);
	});

	test("custom modelVersion is stamped on snapshots", () => {
		const versionedDef = defineWorkflow("order", {
			modelVersion: 2,
			states: {
				Draft: z.object({ items: z.array(z.string()) }),
			},
			commands: {},
			events: {},
			errors: {},
		});
		const wf = versionedDef.createWorkflow("wf-1", {
			initialState: "Draft",
			data: { items: [] },
		});
		const snap = versionedDef.snapshot(wf);
		expect(snap.modelVersion).toBe(2);
	});
});
