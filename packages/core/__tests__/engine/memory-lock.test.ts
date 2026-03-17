import { describe, expect, test, vi } from "vitest";
import { memoryLock } from "../../src/engine/memory-lock.js";

describe("memoryLock", () => {
	test("acquire returns true when lock is free", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		expect(await lock.acquire("wf-1")).toBe(true);
	});

	test("acquire returns false when lock is held", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await lock.acquire("wf-1");
		expect(await lock.acquire("wf-1")).toBe(false);
	});

	test("release makes lock available again", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await lock.acquire("wf-1");
		await lock.release("wf-1");
		expect(await lock.acquire("wf-1")).toBe(true);
	});

	test("different IDs are independent", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await lock.acquire("wf-1");
		expect(await lock.acquire("wf-2")).toBe(true);
	});

	test("lock auto-expires after TTL", async () => {
		vi.useFakeTimers();
		const lock = memoryLock({ ttl: 1_000 });
		await lock.acquire("wf-1");

		vi.advanceTimersByTime(1_001);
		expect(await lock.acquire("wf-1")).toBe(true);
		vi.useRealTimers();
	});

	test("release is a no-op for unheld locks", async () => {
		const lock = memoryLock({ ttl: 5_000 });
		await expect(lock.release("nonexistent")).resolves.toBeUndefined();
	});
});
