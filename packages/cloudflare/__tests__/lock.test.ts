import { describe, expect, test } from "vitest";
import { cloudflareLock } from "../src/adapters/lock.js";

describe("cloudflareLock", () => {
	test("acquire always returns true", async () => {
		const lock = cloudflareLock();
		expect(await lock.acquire("wf-1")).toBe(true);
		expect(await lock.acquire("wf-1")).toBe(true);
		expect(await lock.acquire("wf-2")).toBe(true);
	});

	test("release is a no-op that resolves", async () => {
		const lock = cloudflareLock();
		await expect(lock.release("wf-1")).resolves.toBeUndefined();
	});
});
