import type { StandardSchemaV1 } from "./standard.js";
import type { StateConfig } from "./state.js";

/**
 * A group of related sub-states sharing a common namespace prefix.
 *
 * Returned by {@link defineGroup}. Exposes three things:
 *
 * 1. `states` — spread into {@link defineWorkflow}'s `states` config
 * 2. `names` — array of fully-qualified names, pass to `router.state([...])` for group-wide handlers
 * 3. Dynamic accessors (one per child) — string literals like `group.Pending === "Payment.Pending"`
 *
 * Children can be plain schemas or `state({ schema, clientSchema })` configs.
 * Any shared base fields are expressed in validator-native style at the call site
 * (e.g. `{ ...baseShape, ...childShape }` in Zod, or `v.object({...})` spread in Valibot) —
 * the group itself does no schema merging.
 *
 * @typeParam TName - The group name prefix (e.g. `"Payment"`)
 * @typeParam TChildren - Map of child names to their state entries
 */
export type StateGroup<
	TName extends string,
	TChildren extends Record<string, StandardSchemaV1 | StateConfig>,
> = {
	readonly name: TName;
	readonly states: {
		readonly [K in keyof TChildren as `${TName}.${K & string}`]: TChildren[K];
	};
	readonly names: ReadonlyArray<`${TName}.${keyof TChildren & string}`>;
} & {
	readonly [K in keyof TChildren]: `${TName}.${K & string}`;
};

/**
 * Defines a namespaced group of sub-states.
 *
 * Sub-states are addressed by dot-separated names (e.g. `"Payment.Pending"`).
 * Shared base fields are the consumer's concern — spread a common shape object
 * into each child schema directly. Keeping the group validator-agnostic means it
 * works identically with Zod, Valibot, and ArkType.
 *
 * @example
 * ```ts
 * // Zod
 * const basePayment = { amount: z.number() };
 * const Payment = defineGroup("Payment", {
 *   Pending: z.object({ ...basePayment, attempt: z.number() }),
 *   Failed: z.object({ ...basePayment, reason: z.string() }),
 * });
 *
 * // Valibot — same pattern
 * const baseV = { amount: v.number() };
 * const PaymentV = defineGroup("Payment", {
 *   Pending: v.object({ ...baseV, attempt: v.number() }),
 *   Failed: v.object({ ...baseV, reason: v.string() }),
 * });
 *
 * const def = defineWorkflow("order", {
 *   states: { Draft: z.object({ items: z.array(z.string()) }), ...Payment.states },
 *   commands: { Retry: z.object({}), Cancel: z.object({}) },
 *   events: {},
 *   errors: {},
 * });
 *
 * // Group-wide handler — fires for any Payment.* state
 * router.state(Payment.names, ({ on }) => {
 *   on("Cancel", ({ transition }) => transition("Draft", { items: [] }));
 * });
 *
 * // Sub-state-specific handler
 * router.state(Payment.Pending, ({ on }) => {
 *   on("Retry", ({ data, transition }) => { ... });
 * });
 * ```
 *
 * @param name - Group name prefix (used as the first segment of each state name)
 * @param children - Map of child names to their schemas or `state()` configs
 */
export function defineGroup<
	const TName extends string,
	const TChildren extends Record<string, StandardSchemaV1 | StateConfig>,
>(name: TName, children: TChildren): StateGroup<TName, TChildren> {
	const states: Record<string, StandardSchemaV1 | StateConfig> = {};
	const names: string[] = [];
	const accessors: Record<string, string> = {};

	for (const [childName, child] of Object.entries(children)) {
		const fullName = `${name}.${childName}`;
		states[fullName] = child;
		names.push(fullName);
		accessors[childName] = fullName;
	}

	return Object.freeze({
		name,
		states: Object.freeze(states),
		names: Object.freeze(names),
		...accessors,
	}) as unknown as StateGroup<TName, TChildren>;
}
