import type { z } from "zod";

/**
 * A group of related sub-states that share a common base schema.
 *
 * Returned by {@link defineGroup}. Expose three things:
 *
 * 1. `states` — spread into {@link defineWorkflow}'s `states` config
 * 2. `names` — array of fully-qualified names, pass to `router.state([...])` for group-wide handlers
 * 3. Dynamic accessors (one per child) — string literals like `group.Pending === "Payment.Pending"`
 *
 * @typeParam TName - The group name prefix (e.g. `"Payment"`)
 * @typeParam TBase - The base Zod object schema shared by all sub-states
 * @typeParam TChildren - Map of child names to their Zod object schemas
 */
export type StateGroup<
	TName extends string,
	// biome-ignore lint/suspicious/noExplicitAny: Zod v4 requires explicit shape param on generic constraints
	TBase extends z.ZodObject<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Zod v4 requires explicit shape param on generic constraints
	TChildren extends Record<string, z.ZodObject<any>>,
> = {
	readonly name: TName;
	readonly states: {
		// `any` in the constraint is the upper bound only — TS infers the concrete TBase/TChildren[K]
		// at the call site, so `TBase["shape"]` resolves to the actual shape, not `any`.
		[K in keyof TChildren as `${TName}.${K & string}`]: z.ZodObject<
			TBase["shape"] & TChildren[K]["shape"]
		>;
	};
	readonly names: ReadonlyArray<`${TName}.${keyof TChildren & string}`>;
} & {
	readonly [K in keyof TChildren]: `${TName}.${K & string}`;
};

/**
 * Defines a group of related sub-states sharing a base schema.
 *
 * Sub-states are addressed by dot-separated names (e.g. `"Payment.Pending"`). Each
 * sub-state's data type is `z.infer<base>` combined with `z.infer<child>` (child
 * fields win on collision, per Zod's merge semantics).
 *
 * Spread the returned `states` into `defineWorkflow`'s config; the rest of the
 * engine sees plain flat states and requires no special handling. Use `group.names`
 * with `router.state([...])` to register a handler shared across all sub-states,
 * or `group.ChildName` to target a single sub-state.
 *
 * @example
 * ```ts
 * const Payment = defineGroup("Payment", z.object({ amount: z.number() }), {
 *   Pending: z.object({ attempt: z.number() }),
 *   Failed: z.object({ reason: z.string() }),
 * });
 *
 * const definition = defineWorkflow("order", {
 *   states: { Draft: z.object({ items: z.array(z.string()) }), ...Payment.states },
 *   commands: { Retry: z.object({}), Cancel: z.object({}) },
 *   events: {},
 *   errors: {},
 * });
 *
 * const router = new WorkflowRouter(definition);
 *
 * // Group-wide handler — fires for any Payment.* state
 * router.state(Payment.names, ({ on }) => {
 *   on("Cancel", ({ transition }) => transition("Draft", { items: [] }));
 * });
 *
 * // Sub-state-specific handler — only fires in Payment.Pending
 * router.state(Payment.Pending, ({ on }) => {
 *   on("Retry", ({ data, transition }) => { ... });
 * });
 * ```
 *
 * @param name - Group name prefix (used as the first segment of each state name)
 * @param base - Zod object schema shared by all sub-states
 * @param children - Map of child names to their Zod object schemas; each is merged with `base`
 */
export function defineGroup<
	const TName extends string,
	// biome-ignore lint/suspicious/noExplicitAny: Zod v4 requires explicit shape param on generic constraints
	TBase extends z.ZodObject<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Zod v4 requires explicit shape param on generic constraints
	const TChildren extends Record<string, z.ZodObject<any>>,
>(name: TName, base: TBase, children: TChildren): StateGroup<TName, TBase, TChildren> {
	// biome-ignore lint/suspicious/noExplicitAny: internal implementation uses loose types, public return is precisely typed
	const states: Record<string, z.ZodObject<any>> = {};
	const names: string[] = [];
	const accessors: Record<string, string> = {};

	for (const [childName, childSchema] of Object.entries(children)) {
		const fullName = `${name}.${childName}`;
		states[fullName] = base.merge(childSchema);
		names.push(fullName);
		accessors[childName] = fullName;
	}

	return Object.freeze({
		name,
		states: Object.freeze(states),
		names: Object.freeze(names),
		...accessors,
	}) as unknown as StateGroup<TName, TBase, TChildren>;
}
