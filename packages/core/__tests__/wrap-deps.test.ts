import { describe, expect, test } from "vitest";
import { DependencyErrorSignal } from "../src/types.js";
import { wrapDeps } from "../src/wrap-deps.js";

describe("wrapDeps", () => {
	test("sync function that succeeds passes through", () => {
		const deps = { db: { save: (x: number) => x * 2 } };
		const wrapped = wrapDeps(deps);
		expect(wrapped.db.save(5)).toBe(10);
	});

	test("sync function that throws produces DependencyErrorSignal", () => {
		const deps = {
			db: {
				save: () => {
					throw new Error("connection refused");
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			wrapped.db.save();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).depName).toBe("db");
			expect((err as DependencyErrorSignal).name).toBe("DependencyErrorSignal");
			expect((err as DependencyErrorSignal).message).toBe(
				'Dependency "db" failed: connection refused',
			);
			expect((err as DependencyErrorSignal).error).toBeInstanceOf(Error);
		}
	});

	test("async function that resolves passes through", async () => {
		const deps = { api: { fetch: async (x: number) => x + 1 } };
		const wrapped = wrapDeps(deps);
		await expect(wrapped.api.fetch(3)).resolves.toBe(4);
	});

	test("async function that rejects produces DependencyErrorSignal", async () => {
		const deps = {
			api: {
				fetch: async () => {
					throw new Error("timeout");
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			await wrapped.api.fetch();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).depName).toBe("api");
			expect((err as DependencyErrorSignal).message).toBe('Dependency "api" failed: timeout');
		}
	});

	test("nested object access tracks top-level dep name", async () => {
		const deps = {
			db: {
				users: {
					find: async () => {
						throw new Error("not found");
					},
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			await wrapped.db.users.find();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).depName).toBe("db");
			expect((err as DependencyErrorSignal).message).toBe('Dependency "db" failed: not found');
		}
	});

	test("primitive properties pass through unwrapped", () => {
		const deps = { config: { timeout: 5000, name: "test", enabled: true } };
		const wrapped = wrapDeps(deps);
		expect(wrapped.config.timeout).toBe(5000);
		expect(wrapped.config.name).toBe("test");
		expect(wrapped.config.enabled).toBe(true);
	});

	test("null and undefined properties pass through", () => {
		const deps = { cache: null, logger: undefined };
		const wrapped = wrapDeps(deps);
		expect(wrapped.cache).toBeNull();
		expect(wrapped.logger).toBeUndefined();
	});

	test("symbol-keyed properties pass through without wrapping", () => {
		const sym = Symbol("test");
		const obj = { [sym]: () => 42 };
		const deps = { svc: obj };
		const wrapped = wrapDeps(deps);
		expect(wrapped.svc[sym]()).toBe(42);
	});

	test("this binding is preserved for class methods", () => {
		class DB {
			#connection = "live";
			query() {
				return this.#connection;
			}
		}
		const deps = { db: new DB() };
		const wrapped = wrapDeps(deps);
		expect(wrapped.db.query()).toBe("live");
	});

	test("non-error throws are wrapped with String coercion", () => {
		const deps = {
			svc: {
				call: () => {
					throw "raw string error";
				},
			},
		};
		const wrapped = wrapDeps(deps);
		try {
			wrapped.svc.call();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DependencyErrorSignal);
			expect((err as DependencyErrorSignal).message).toBe(
				'Dependency "svc" failed: raw string error',
			);
			expect((err as DependencyErrorSignal).error).toBe("raw string error");
		}
	});
});
