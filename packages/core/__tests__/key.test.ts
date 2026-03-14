import { describe, expect, test } from "vitest";
import { createKey } from "../src/key.js";

describe("ContextKey", () => {
	test("createKey returns an object with a symbol id", () => {
		const key = createKey<string>("testKey");
		expect(typeof key.id).toBe("symbol");
	});

	test("two keys with the same name have different ids", () => {
		const key1 = createKey<string>("same");
		const key2 = createKey<string>("same");
		expect(key1.id).not.toBe(key2.id);
	});

	test("key can be used as a Map key", () => {
		const key = createKey<number>("count");
		const map = new Map<symbol, unknown>();
		map.set(key.id, 42);
		expect(map.get(key.id)).toBe(42);
	});
});
