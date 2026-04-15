import { describe, expect, expectTypeOf, test } from "vitest";
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

	test("names array contains all fully-qualified state names", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
			Retrying: z.object({ nextRetryAt: z.date() }),
		});

		expect(group.names).toEqual(["Payment.Pending", "Payment.Failed", "Payment.Retrying"]);
	});

	test("dynamic accessors return the fully-qualified name", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		// biome-ignore lint/suspicious/noExplicitAny: dynamic property access for runtime check
		expect((group as any).Pending).toBe("Payment.Pending");
		// biome-ignore lint/suspicious/noExplicitAny: dynamic property access for runtime check
		expect((group as any).Failed).toBe("Payment.Failed");
	});

	test("merged schema validates combined parent + child fields", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		const schema = group.states["Payment.Pending"];
		expect(schema.safeParse({ amount: 100, attempt: 1 }).success).toBe(true);
	});

	test("merged schema rejects data missing parent fields", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		expect(group.states["Payment.Pending"].safeParse({ attempt: 1 }).success).toBe(false);
	});

	test("merged schema rejects data missing child fields", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		expect(group.states["Payment.Pending"].safeParse({ amount: 100 }).success).toBe(false);
	});

	test("child fields override parent fields on key collision (Zod merge semantics)", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Refund: z.object({ amount: z.string() }), // child narrows amount to string
		});

		const schema = group.states["Payment.Refund"];
		expect(schema.safeParse({ amount: "full" }).success).toBe(true);
		expect(schema.safeParse({ amount: 100 }).success).toBe(false);
	});

	test("empty children record produces empty states and names", () => {
		const group = defineGroup("Empty", z.object({ x: z.number() }), {});
		expect(group.states).toEqual({});
		expect(group.names).toEqual([]);
	});

	test("group, states, and names are frozen", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		expect(Object.isFrozen(group)).toBe(true);
		expect(Object.isFrozen(group.states)).toBe(true);
		expect(Object.isFrozen(group.names)).toBe(true);
	});
});

describe("defineGroup() types", () => {
	test("accessors are string-literal types, not widened to string", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		expectTypeOf(group.Pending).toEqualTypeOf<"Payment.Pending">();
		expectTypeOf(group.Failed).toEqualTypeOf<"Payment.Failed">();
	});

	test("names is a readonly array of the union of sub-state names", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
			Failed: z.object({ reason: z.string() }),
		});

		expectTypeOf(group.names).toEqualTypeOf<ReadonlyArray<"Payment.Pending" | "Payment.Failed">>();
	});

	test("states record keys are the fully-qualified names", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		type Keys = keyof typeof group.states;
		expectTypeOf<Keys>().toEqualTypeOf<"Payment.Pending">();
	});

	test("each state schema infers to the merged shape", () => {
		const group = defineGroup("Payment", z.object({ amount: z.number() }), {
			Pending: z.object({ attempt: z.number() }),
		});

		type Inferred = z.infer<(typeof group.states)["Payment.Pending"]>;
		expectTypeOf<Inferred>().toEqualTypeOf<{ amount: number; attempt: number }>();
	});
});
