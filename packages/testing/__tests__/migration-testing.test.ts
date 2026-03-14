import { defineMigrations, defineWorkflow } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
	testMigration,
	testMigrationPath,
	testMigrationRestore,
} from "../src/migration-testing.js";

const definition = defineWorkflow("task", {
	modelVersion: 3,
	states: {
		Draft: z.object({ title: z.string(), status: z.string(), tags: z.array(z.string()) }),
	},
	commands: {},
	events: {},
	errors: {},
});

const migrations = defineMigrations(definition, {
	2: (snap) => ({
		...snap,
		data: { ...(snap.data as { title: string }), status: "active" },
	}),
	3: (snap) => ({
		...snap,
		data: { ...(snap.data as { title: string; status: string }), tags: [] },
	}),
});

describe("testMigration()", () => {
	test("verifies a single migration step", () => {
		testMigration(migrations, {
			from: 1,
			input: { title: "hello" },
			expected: { title: "hello", status: "active" },
		});
	});

	test("throws when output doesn't match expected", () => {
		expect(() =>
			testMigration(migrations, {
				from: 1,
				input: { title: "hello" },
				expected: { title: "hello", status: "wrong" },
			}),
		).toThrow();
	});

	test("verifies step 2 → 3", () => {
		testMigration(migrations, {
			from: 2,
			input: { title: "hello", status: "active" },
			expected: { title: "hello", status: "active", tags: [] },
		});
	});
});

describe("testMigrationPath()", () => {
	test("verifies full migration chain", () => {
		testMigrationPath(migrations, {
			from: 1,
			input: { title: "hello" },
			expectVersion: 3,
			expected: { title: "hello", status: "active", tags: [] },
		});
	});

	test("throws when final version doesn't match", () => {
		expect(() =>
			testMigrationPath(migrations, {
				from: 1,
				input: { title: "hello" },
				expectVersion: 2,
				expected: { title: "hello", status: "active" },
			}),
		).toThrow("version");
	});

	test("throws when final data doesn't match", () => {
		expect(() =>
			testMigrationPath(migrations, {
				from: 1,
				input: { title: "hello" },
				expectVersion: 3,
				expected: { title: "wrong" },
			}),
		).toThrow();
	});
});

describe("testMigrationRestore()", () => {
	test("verifies migrate + restore round-trip", () => {
		testMigrationRestore(migrations, {
			from: 1,
			input: { title: "hello" },
			expectState: "Draft",
		});
	});

	test("throws when restore fails (bad migration output)", () => {
		const badMigrations = defineMigrations(
			defineWorkflow("bad", {
				modelVersion: 2,
				states: { Draft: z.object({ required: z.string() }) },
				commands: {},
				events: {},
				errors: {},
			}),
			{
				2: (snap) => ({
					...snap,
					data: { notTheRightField: true },
				}),
			},
		);

		expect(() =>
			testMigrationRestore(badMigrations, {
				from: 1,
				input: {},
				expectState: "Draft",
			}),
		).toThrow("restore");
	});
});
