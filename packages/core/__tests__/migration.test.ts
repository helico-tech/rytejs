import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { defineMigrations, MigrationError, migrate } from "../src/migration.js";

const definitionV3 = defineWorkflow("order", {
	modelVersion: 3,
	states: {
		Draft: z.object({ items: z.array(z.string()), status: z.string(), fullName: z.string() }),
	},
	commands: {},
	events: {},
	errors: {},
});

const definitionV1 = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.array(z.string()) }),
	},
	commands: {},
	events: {},
	errors: {},
});

describe("defineMigrations()", () => {
	test("creates a pipeline with valid migrations", () => {
		const pipeline = defineMigrations(definitionV3, {
			2: (snap) => ({
				...snap,
				// biome-ignore lint/suspicious/noExplicitAny: migration spreads opaque snapshot data
				data: { ...(snap.data as any), status: "active" },
			}),
			3: (snap) => ({
				...snap,
				// biome-ignore lint/suspicious/noExplicitAny: migration spreads opaque snapshot data
				data: { ...(snap.data as any), fullName: "unknown" },
			}),
		});
		expect(pipeline.targetVersion).toBe(3);
		expect(pipeline.migrations.size).toBe(2);
		expect(pipeline.definition).toBe(definitionV3);
	});

	test("throws if migration key is <= 1", () => {
		expect(() =>
			defineMigrations(definitionV3, {
				1: (snap) => snap,
				2: (snap) => snap,
				3: (snap) => snap,
			}),
		).toThrow("Migration keys must be > 1");
	});

	test("throws if there are gaps in version sequence", () => {
		expect(() =>
			defineMigrations(definitionV3, {
				2: (snap) => snap,
			}),
		).toThrow("does not match");
	});

	test("throws if highest key doesn't match definition modelVersion", () => {
		expect(() =>
			defineMigrations(definitionV3, {
				2: (snap) => snap,
				3: (snap) => snap,
				4: (snap) => snap,
			}),
		).toThrow("does not match");
	});

	test("accepts empty map for modelVersion 1 definition", () => {
		const pipeline = defineMigrations(definitionV1, {});
		expect(pipeline.targetVersion).toBe(1);
		expect(pipeline.migrations.size).toBe(0);
	});
});

describe("migrate()", () => {
	const pipeline = defineMigrations(definitionV3, {
		2: (snap) => ({
			...snap,
			// biome-ignore lint/suspicious/noExplicitAny: migration spreads opaque snapshot data
			data: { ...(snap.data as any), status: "active" },
		}),
		3: (snap) => ({
			...snap,
			// biome-ignore lint/suspicious/noExplicitAny: migration spreads opaque snapshot data
			data: { ...(snap.data as any), fullName: "unknown" },
		}),
	});

	function makeSnapshot(version: number, data: unknown = { items: [] }) {
		return {
			id: "wf-1",
			definitionName: "order",
			state: "Draft" as const,
			data,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: version,
			version: 1,
		};
	}

	test("runs migration chain v1 → v3", () => {
		const result = migrate(pipeline, makeSnapshot(1));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot.modelVersion).toBe(3);
			expect(result.snapshot.data).toEqual({
				items: [],
				status: "active",
				fullName: "unknown",
			});
		}
	});

	test("returns snapshot as-is when already at target version", () => {
		const snap = makeSnapshot(3, { items: [], status: "active", fullName: "known" });
		const result = migrate(pipeline, snap);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot).toEqual(snap);
		}
	});

	test("returns error when snapshot version is higher than target", () => {
		const result = migrate(pipeline, makeSnapshot(5));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(MigrationError);
			expect(result.error.message).toContain("higher");
		}
	});

	test("returns error when snapshot modelVersion is not a positive integer", () => {
		const result = migrate(pipeline, makeSnapshot(0));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(MigrationError);
		}
	});

	test("returns error when definitionName doesn't match", () => {
		const snap = { ...makeSnapshot(1), definitionName: "other" };
		const result = migrate(pipeline, snap);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("definition");
		}
	});

	test("auto-stamps modelVersion after each step", () => {
		const versions: number[] = [];
		migrate(pipeline, makeSnapshot(1), {
			onStep: (_from, _to, snap) => {
				versions.push(snap.modelVersion);
			},
		});
		expect(versions).toEqual([2, 3]);
	});

	test("catches migration function errors and returns MigrationError", () => {
		const badPipeline = defineMigrations(
			defineWorkflow("bad", {
				modelVersion: 2,
				states: { A: z.object({}) },
				commands: {},
				events: {},
				errors: {},
			}),
			{
				2: () => {
					throw new Error("transform broke");
				},
			},
		);
		const snap = {
			id: "wf-1",
			definitionName: "bad",
			state: "A" as const,
			data: {},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		};
		const result = migrate(badPipeline, snap);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(MigrationError);
			expect(result.error.fromVersion).toBe(1);
			expect(result.error.toVersion).toBe(2);
			expect(result.error.message).toContain("transform broke");
		}
	});

	test("onError callback fires on failure", () => {
		const onError = vi.fn();
		const badPipeline = defineMigrations(
			defineWorkflow("bad", {
				modelVersion: 2,
				states: { A: z.object({}) },
				commands: {},
				events: {},
				errors: {},
			}),
			{
				2: () => {
					throw new Error("fail");
				},
			},
		);
		const snap = {
			id: "wf-1",
			definitionName: "bad",
			state: "A" as const,
			data: {},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		};
		migrate(badPipeline, snap, { onError });
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(MigrationError);
	});

	test("onStep callback fires for each successful step", () => {
		const onStep = vi.fn();
		migrate(pipeline, makeSnapshot(1), { onStep });
		expect(onStep).toHaveBeenCalledTimes(2);
		expect(onStep.mock.calls[0]?.[0]).toBe(1);
		expect(onStep.mock.calls[0]?.[1]).toBe(2);
		expect(onStep.mock.calls[1]?.[0]).toBe(2);
		expect(onStep.mock.calls[1]?.[1]).toBe(3);
	});

	test("migration entries with descriptions pass description to onStep", () => {
		const describedPipeline = defineMigrations(definitionV3, {
			2: {
				description: "Add status field",
				up: (snap) => ({
					...snap,
					data: { ...(snap.data as Record<string, unknown>), status: "active" },
				}),
			},
			3: {
				description: "Add fullName field",
				up: (snap) => ({
					...snap,
					data: { ...(snap.data as Record<string, unknown>), fullName: "unknown" },
				}),
			},
		});
		const descriptions: (string | undefined)[] = [];
		migrate(describedPipeline, makeSnapshot(1), {
			onStep: (_from, _to, _snap, description) => {
				descriptions.push(description);
			},
		});
		expect(descriptions).toEqual(["Add status field", "Add fullName field"]);
	});

	test("bare function migrations have undefined description in onStep", () => {
		const descriptions: (string | undefined)[] = [];
		migrate(pipeline, makeSnapshot(1), {
			onStep: (_from, _to, _snap, description) => {
				descriptions.push(description);
			},
		});
		expect(descriptions).toEqual([undefined, undefined]);
	});

	test("no-op pipeline for modelVersion 1 returns snapshot as-is", () => {
		const noopPipeline = defineMigrations(definitionV1, {});
		const snap = makeSnapshot(1);
		const result = migrate(noopPipeline, snap);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot).toEqual(snap);
		}
	});
});
