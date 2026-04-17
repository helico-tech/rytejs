import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../src/definition.js";
import { defineGroup } from "../src/group.js";
import { WorkflowRouter } from "../src/router.js";

// Shared base shape — spread into each child by the consumer, validator-native.
const basePayment = { amount: z.number() };

describe("defineGroup()", () => {
	test("produces states record with dot-prefixed keys", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
			Failed: z.object({ ...basePayment, reason: z.string() }),
		});

		expect(Object.keys(group.states)).toEqual(["Payment.Pending", "Payment.Failed"]);
	});

	test("names array contains all fully-qualified state names", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
			Failed: z.object({ ...basePayment, reason: z.string() }),
			Retrying: z.object({ ...basePayment, nextRetryAt: z.date() }),
		});

		expect(group.names).toEqual(["Payment.Pending", "Payment.Failed", "Payment.Retrying"]);
	});

	test("dynamic accessors return the fully-qualified name", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
			Failed: z.object({ ...basePayment, reason: z.string() }),
		});

		// biome-ignore lint/suspicious/noExplicitAny: dynamic property access for runtime check
		expect((group as any).Pending).toBe("Payment.Pending");
		// biome-ignore lint/suspicious/noExplicitAny: dynamic property access for runtime check
		expect((group as any).Failed).toBe("Payment.Failed");
	});

	test("child schema validates both consumer-merged base and child fields", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
		});

		// biome-ignore lint/suspicious/noExplicitAny: test accesses the raw schema's safeParse
		const schema = group.states["Payment.Pending"] as any;
		expect(schema.safeParse({ amount: 100, attempt: 1 }).success).toBe(true);
		expect(schema.safeParse({ attempt: 1 }).success).toBe(false);
		expect(schema.safeParse({ amount: 100 }).success).toBe(false);
	});

	test("empty children record produces empty states and names", () => {
		const group = defineGroup("Empty", {});
		expect(group.states).toEqual({});
		expect(group.names).toEqual([]);
	});

	test("group, states, and names are frozen", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
		});

		expect(Object.isFrozen(group)).toBe(true);
		expect(Object.isFrozen(group.states)).toBe(true);
		expect(Object.isFrozen(group.names)).toBe(true);
	});
});

describe("defineGroup() types", () => {
	test("accessors are string-literal types, not widened to string", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
			Failed: z.object({ ...basePayment, reason: z.string() }),
		});

		expectTypeOf(group.Pending).toEqualTypeOf<"Payment.Pending">();
		expectTypeOf(group.Failed).toEqualTypeOf<"Payment.Failed">();
	});

	test("names is a readonly array of the union of sub-state names", () => {
		const group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
			Failed: z.object({ ...basePayment, reason: z.string() }),
		});

		expectTypeOf(group.names).toEqualTypeOf<ReadonlyArray<"Payment.Pending" | "Payment.Failed">>();
	});

	test("states record keys are the fully-qualified names", () => {
		const _group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
		});

		type Keys = keyof typeof _group.states;
		expectTypeOf<Keys>().toEqualTypeOf<"Payment.Pending">();
	});

	test("each child schema infers to its consumer-written shape", () => {
		const _group = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
		});

		type Inferred = z.infer<(typeof _group.states)["Payment.Pending"]>;
		expectTypeOf<Inferred>().toEqualTypeOf<{ amount: number; attempt: number }>();
	});
});

describe("defineGroup() integration with defineWorkflow + WorkflowRouter", () => {
	function buildOrderWorkflow() {
		const Payment = defineGroup("Payment", {
			Pending: z.object({ ...basePayment, attempt: z.number() }),
			Failed: z.object({ ...basePayment, reason: z.string() }),
			Retrying: z.object({ ...basePayment, attempt: z.number(), nextRetryAt: z.date() }),
		});

		const definition = defineWorkflow("order", {
			states: {
				Draft: z.object({ items: z.array(z.string()) }),
				...Payment.states,
				Shipped: z.object({ trackingId: z.string() }),
			},
			commands: {
				StartPayment: z.object({ amount: z.number() }),
				RetryPayment: z.object({}),
				CancelPayment: z.object({}),
				FailPayment: z.object({ reason: z.string() }),
			},
			events: {},
			errors: {},
		});

		return { Payment, definition };
	}

	test("spreading group.states into definition registers all sub-states", () => {
		const { definition } = buildOrderWorkflow();
		expect(definition.hasState("Payment.Pending")).toBe(true);
		expect(definition.hasState("Payment.Failed")).toBe(true);
		expect(definition.hasState("Payment.Retrying")).toBe(true);
		expect(definition.hasState("Draft")).toBe(true);
		expect(definition.hasState("Shipped")).toBe(true);
	});

	test("createWorkflow accepts a sub-state as initial state with merged data", () => {
		const { definition } = buildOrderWorkflow();
		const wf = definition.createWorkflow("order-1", {
			initialState: "Payment.Pending",
			data: { amount: 100, attempt: 1 },
		});
		expect(wf.state).toBe("Payment.Pending");
		expect(wf.data).toEqual({ amount: 100, attempt: 1 });
	});

	test("handler on a specific sub-state fires for that sub-state", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);

		router.state(Payment.Pending, ({ on }) => {
			on("RetryPayment", ({ data, transition }) => {
				transition("Payment.Retrying", {
					amount: data.amount,
					attempt: data.attempt + 1,
					nextRetryAt: new Date("2026-01-01T00:00:00Z"),
				});
			});
		});

		const wf = definition.createWorkflow("w1", {
			initialState: "Payment.Pending",
			data: { amount: 100, attempt: 1 },
		});

		const result = await router.dispatch(wf, "RetryPayment", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.state).toBe("Payment.Retrying");
		}
	});

	test("handler on group.names fires for every sub-state in the group", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);
		const seen: string[] = [];

		router.state(Payment.names, ({ on }) => {
			on("CancelPayment", ({ workflow, transition }) => {
				seen.push(workflow.state);
				transition("Draft", { items: [] });
			});
		});

		for (const [initialState, data] of [
			["Payment.Pending", { amount: 100, attempt: 1 }],
			["Payment.Failed", { amount: 100, reason: "declined" }],
			["Payment.Retrying", { amount: 100, attempt: 2, nextRetryAt: new Date() }],
		] as const) {
			const wf = definition.createWorkflow("w", { initialState, data });
			const result = await router.dispatch(wf, "CancelPayment", {});
			expect(result.ok).toBe(true);
		}

		expect(seen).toEqual(["Payment.Pending", "Payment.Failed", "Payment.Retrying"]);
	});

	test("sub-state-specific handler wins over group-wide handler", async () => {
		const { Payment, definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);
		const tag: string[] = [];

		router.state(Payment.names, ({ on }) => {
			on("CancelPayment", ({ transition }) => {
				tag.push("group");
				transition("Draft", { items: [] });
			});
		});

		router.state(Payment.Pending, ({ on }) => {
			on("CancelPayment", ({ transition }) => {
				tag.push("specific");
				transition("Draft", { items: [] });
			});
		});

		const wf = definition.createWorkflow("w", {
			initialState: "Payment.Pending",
			data: { amount: 100, attempt: 1 },
		});
		await router.dispatch(wf, "CancelPayment", {});
		expect(tag).toEqual(["specific"]);
		expect(tag).not.toContain("group");
	});

	test("transition to a sub-state validates against the consumer-written schema", async () => {
		const { definition } = buildOrderWorkflow();
		const router = new WorkflowRouter(definition);

		router.state("Draft", ({ on }) => {
			on("StartPayment", ({ command, transition }) => {
				// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid data to test validation
				transition("Payment.Pending", { amount: command.payload.amount } as any);
			});
		});

		const wf = definition.createWorkflow("w", {
			initialState: "Draft",
			data: { items: ["book"] },
		});

		const result = await router.dispatch(wf, "StartPayment", { amount: 100 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.category).toBe("validation");
			if (result.error.category === "validation") {
				expect(result.error.source).toBe("transition");
			}
		}
	});

	test("snapshot and deserialize round-trip a sub-state correctly", () => {
		const { definition } = buildOrderWorkflow();
		const wf = definition.createWorkflow("order-1", {
			initialState: "Payment.Retrying",
			data: { amount: 50, attempt: 3, nextRetryAt: new Date("2026-01-01T00:00:00Z") },
		});

		const snapshot = definition.serialize(wf);
		expect(snapshot.state).toBe("Payment.Retrying");

		const restored = definition.deserialize(snapshot);
		expect(restored.ok).toBe(true);
		if (restored.ok) {
			expect(restored.workflow.state).toBe("Payment.Retrying");
			expect(restored.workflow.data).toMatchObject({ amount: 50, attempt: 3 });
		}
	});
});
