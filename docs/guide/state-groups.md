# State Groups

State groups let you define a set of related sub-states that share a common base schema, addressed by dot-separated names like `"Payment.Pending"` and `"Payment.Failed"`.

They solve three concrete problems:

- **State-name explosion** — keep the top-level state list readable
- **Shared handlers** — one handler for every `Payment.*` sub-state
- **Shared data** — parent fields automatically on every sub-state, child fields extend them

Groups are a pure schema helper. The engine sees flat states after the group is spread into the config; nothing about dispatch, snapshots, or migrations changes.

## Defining a Group

`defineGroup(name, base, children)` takes a prefix, a base `z.object()` schema, and a record of child schemas. Each child's schema is merged with the base.

<<< @/snippets/guide/state-groups.ts#define-group

The returned value exposes:

- `states` — spread into `defineWorkflow`'s `states` config
- `names` — an array of fully-qualified names (`["Payment.Pending", "Payment.Failed", ...]`)
- Dynamic string-literal accessors — `Payment.Pending === "Payment.Pending"`

## Spreading into a Workflow

<<< @/snippets/guide/state-groups.ts#spread-into-config

After the spread, `"Payment.Pending"`, `"Payment.Failed"`, and `"Payment.Retrying"` are first-class states alongside `"Draft"` and `"Shipped"`. `StateNames<TConfig>` includes them all.

## Handlers on a Specific Sub-State

Pass the string-literal accessor (e.g. `Payment.Pending`) to `router.state()`. Inside the handler, `ctx.data` has the full merged type — base fields plus child-specific fields.

<<< @/snippets/guide/state-groups.ts#sub-state-handler

## Handlers on the Whole Group

Pass `group.names` to `router.state()` to register a handler that fires in every sub-state. Inside the handler, `ctx.data` is the union of all sub-state data types — shared fields (from the base) are directly accessible, but child-specific fields require `ctx.match()` to narrow.

<<< @/snippets/guide/state-groups.ts#group-handler

**Note on `match()` inside a group handler:** `match()` is typed against the workflow's full `StateNames`, not just the group's sub-states. Even though your handler only runs inside `Payment.*` at runtime, you still need the fallback form `match(matchers, () => ...)` to satisfy the type checker. The fallback branch will never be hit in practice.

Sub-state-specific handlers take priority over group-wide handlers. If a command matches both, only the sub-state-specific one runs.

## Transitioning

Transitions work exactly as they do for flat states. `transition("Payment.Failed", data)` validates `data` against the merged schema — both base and child fields are required.

## When NOT to Use Groups

- **No shared base fields** — just use flat states. Groups only pay off when the base carries meaningful data.
- **Non-object schemas** — `defineGroup` requires `z.object()` for both base and children. If you need `z.union`, `z.string`, or similar, register the states flatly under dot-separated names.
- **Full statechart semantics** — Ryte doesn't support entry/exit actions, history pseudo-states, or automatic parent-handler fallthrough on missed commands. Groups are a naming-and-schema mechanism, not a hierarchical state machine.

## Limitations

- Base and children must be `z.ZodObject` (i.e. `z.object({...})`)
- Groups are flat — a child cannot itself be a group
- On key collision, Zod's merge resolves child-wins (child schema overrides parent field type)
- Spreading into `states` follows JS object-spread semantics — a later key overwrites an earlier one silently
