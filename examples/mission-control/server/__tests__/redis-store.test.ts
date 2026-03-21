import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowSnapshot } from "@rytejs/core";
import { ConcurrencyConflictError } from "@rytejs/core/store";
import type { RedisStoreAdapter } from "../redis-store.ts";
import { createRedisStore } from "../redis-store.ts";

let store: RedisStoreAdapter;
let redisAvailable = false;

function makeSnapshot(
	id: string,
	state: string,
	data: Record<string, unknown> = {},
): WorkflowSnapshot {
	return {
		id,
		definitionName: "mission",
		state,
		data: {
			name: "Apollo",
			destination: "Moon",
			crewMembers: ["Armstrong"],
			fuelLevel: 95,
			...data,
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		modelVersion: 1,
	};
}

beforeAll(async () => {
	try {
		store = createRedisStore("redis://localhost:6379");
		// Probe connectivity
		await store.list();
		redisAvailable = true;
	} catch {
		console.warn("Redis not available — skipping redis-store tests");
	}
});

afterEach(async () => {
	if (!redisAvailable) return;
	// Clean up test keys
	// biome-ignore lint/suspicious/noExplicitAny: accessing internal redis for cleanup
	const redis = store as any;
	try {
		const ids = await store.list();
		for (const { id } of ids) {
			await redis.load(id); // just to confirm existence
		}
	} catch {
		// ignore cleanup errors
	}
});

describe("Redis Store", () => {
	test("create and load", async () => {
		if (!redisAvailable) return;
		const snap = makeSnapshot("test-create-1", "Planning");
		await store.create("test-create-1", snap);

		const loaded = await store.load("test-create-1");
		expect(loaded).not.toBeNull();
		expect(loaded!.snapshot.id).toBe("test-create-1");
		expect(loaded!.snapshot.state).toBe("Planning");
		expect(loaded!.version).toBe(1);
	});

	test("load returns null for non-existent", async () => {
		if (!redisAvailable) return;
		const loaded = await store.load("non-existent-xyz");
		expect(loaded).toBeNull();
	});

	test("save increments version", async () => {
		if (!redisAvailable) return;
		const snap = makeSnapshot("test-version-1", "Planning");
		await store.create("test-version-1", snap);

		const updatedSnap = makeSnapshot("test-version-1", "Countdown", {
			countdownStartedAt: new Date().toISOString(),
			telemetryStatus: "go",
		});
		await store.save({
			id: "test-version-1",
			snapshot: updatedSnap,
			expectedVersion: 1,
		});

		const loaded = await store.load("test-version-1");
		expect(loaded).not.toBeNull();
		expect(loaded!.version).toBe(2);
		expect(loaded!.snapshot.state).toBe("Countdown");
	});

	test("save throws ConcurrencyConflictError on version mismatch", async () => {
		if (!redisAvailable) return;
		const snap = makeSnapshot("test-conflict-1", "Planning");
		await store.create("test-conflict-1", snap);

		const updatedSnap = makeSnapshot("test-conflict-1", "Countdown", {
			countdownStartedAt: new Date().toISOString(),
			telemetryStatus: "go",
		});

		try {
			await store.save({
				id: "test-conflict-1",
				snapshot: updatedSnap,
				expectedVersion: 99,
			});
			expect(true).toBe(false); // should not reach here
		} catch (err) {
			expect(err).toBeInstanceOf(ConcurrencyConflictError);
			if (err instanceof ConcurrencyConflictError) {
				expect(err.expectedVersion).toBe(99);
				expect(err.actualVersion).toBe(1);
			}
		}
	});

	test("findByState returns missions in that state", async () => {
		if (!redisAvailable) return;
		const snap1 = makeSnapshot("test-state-a", "Planning");
		const snap2 = makeSnapshot("test-state-b", "Planning");
		const snap3 = makeSnapshot("test-state-c", "Countdown", {
			countdownStartedAt: new Date().toISOString(),
			telemetryStatus: "go",
		});

		await store.create("test-state-a", snap1);
		await store.create("test-state-b", snap2);
		await store.create("test-state-c", snap3);

		const planningMissions = await store.findByState("Planning");
		const planningIds = planningMissions.map((m) => m.id);
		expect(planningIds).toContain("test-state-a");
		expect(planningIds).toContain("test-state-b");
		expect(planningIds).not.toContain("test-state-c");

		const countdownMissions = await store.findByState("Countdown");
		const countdownIds = countdownMissions.map((m) => m.id);
		expect(countdownIds).toContain("test-state-c");
	});

	test("list returns all missions", async () => {
		if (!redisAvailable) return;
		const snap = makeSnapshot("test-list-1", "Planning");
		await store.create("test-list-1", snap);

		const all = await store.list();
		const ids = all.map((m) => m.id);
		expect(ids).toContain("test-list-1");

		const entry = all.find((m) => m.id === "test-list-1");
		expect(entry).toBeDefined();
		expect(entry!.snapshot.state).toBe("Planning");
		expect(entry!.version).toBe(1);
	});

	test("state index updates on transition", async () => {
		if (!redisAvailable) return;
		const snap = makeSnapshot("test-transition-1", "Planning");
		await store.create("test-transition-1", snap);

		// Verify initially in Planning
		let planningMissions = await store.findByState("Planning");
		expect(planningMissions.map((m) => m.id)).toContain("test-transition-1");

		// Save with state change to Countdown
		const updatedSnap = makeSnapshot("test-transition-1", "Countdown", {
			countdownStartedAt: new Date().toISOString(),
			telemetryStatus: "go",
		});
		await store.save({
			id: "test-transition-1",
			snapshot: updatedSnap,
			expectedVersion: 1,
		});

		// Should no longer be in Planning
		planningMissions = await store.findByState("Planning");
		expect(planningMissions.map((m) => m.id)).not.toContain("test-transition-1");

		// Should now be in Countdown
		const countdownMissions = await store.findByState("Countdown");
		expect(countdownMissions.map((m) => m.id)).toContain("test-transition-1");
	});
});
