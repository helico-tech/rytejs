import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineGroup } from "../src/group.js";

describe("defineGroup()", () => {
	test("produces states record with dot-prefixed keys", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		expect(Object.keys(group.states)).toEqual(["Payment.Pending", "Payment.Failed"]);
	});
});
