import { describe, expect, test } from "vitest";
import { createTestDeps } from "../src/create-test-deps.js";

type MyDeps = {
	paymentService: { charge: (amount: number) => Promise<boolean> };
	emailService: { send: (to: string, body: string) => void };
};

describe("createTestDeps", () => {
	test("returns partial cast to full type", () => {
		const deps = createTestDeps<MyDeps>({
			paymentService: { charge: async () => true },
		});
		expect(deps.paymentService.charge).toBeDefined();
	});

	test("missing deps are undefined at runtime", () => {
		const deps = createTestDeps<MyDeps>({
			paymentService: { charge: async () => true },
		});
		expect((deps as any).emailService).toBeUndefined();
	});

	test("empty partial produces empty deps", () => {
		const deps = createTestDeps<MyDeps>({});
		expect(deps).toEqual({});
	});
});
