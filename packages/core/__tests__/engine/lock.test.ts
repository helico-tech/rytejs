import { describe, expect, test } from "vitest";
import { withLock } from "../../src/engine/lock.js";

describe("withLock", () => {
	test("executes function and returns result", async () => {
		const result = await withLock("wf-1", () => Promise.resolve(42), 5000);
		expect(result).toBe(42);
	});

	test("serializes concurrent calls for the same ID", async () => {
		const order: number[] = [];
		const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const p1 = withLock(
			"wf-1",
			async () => {
				order.push(1);
				await delay(50);
				order.push(2);
			},
			5000,
		);

		const p2 = withLock(
			"wf-1",
			async () => {
				order.push(3);
				await delay(10);
				order.push(4);
			},
			5000,
		);

		await Promise.all([p1, p2]);
		expect(order).toEqual([1, 2, 3, 4]);
	});

	test("allows parallel calls for different IDs", async () => {
		const order: string[] = [];
		const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const p1 = withLock(
			"wf-1",
			async () => {
				order.push("a-start");
				await delay(50);
				order.push("a-end");
			},
			5000,
		);

		const p2 = withLock(
			"wf-2",
			async () => {
				order.push("b-start");
				await delay(10);
				order.push("b-end");
			},
			5000,
		);

		await Promise.all([p1, p2]);
		expect(order[0]).toBe("a-start");
		expect(order[1]).toBe("b-start");
	});

	test("releases lock if function throws", async () => {
		await expect(withLock("wf-1", () => Promise.reject(new Error("boom")), 5000)).rejects.toThrow(
			"boom",
		);

		const result = await withLock("wf-1", () => Promise.resolve("ok"), 5000);
		expect(result).toBe("ok");
	});

	test("rejects with timeout if lock is held too long", async () => {
		const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const p1 = withLock("wf-1", () => delay(200), 5000);
		const p2 = withLock("wf-1", () => Promise.resolve("done"), 50);

		await expect(p2).rejects.toThrow("Lock timeout");
		await p1;
	});
});
