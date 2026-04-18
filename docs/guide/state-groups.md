# State Groups

State groups let you organise related sub-states under a common namespace prefix, addressed by dot-separated names like `"Payment.Pending"` and `"Payment.Failed"`.

They solve two concrete problems:

- **State-name explosion** — keep the top-level state list readable
- **Shared handlers** — one handler for every `Payment.*` sub-state

Groups are a pure namespacing helper. The engine sees flat states after the group is spread into the config; nothing about dispatch, snapshots, or migrations changes.

## Defining a Group

`defineGroup(name, children)` takes a prefix and a record of child schemas (or `state()` configs). The group itself does **not** merge schemas — you express shared fields at the call site by spreading a plain shape object into each child.

<<< @/snippets/guide/state-groups.ts#define-group

Why no magic merging? Keeping schemas intact makes groups **validator-agnostic** — the same pattern works with Valibot (`v.object({ ...baseV, ... })`) or ArkType. Schema merging is a validator-specific idiom; rytejs stays out of it.

The returned value exposes:

- `states` — spread into `defineWorkflow`'s `states` config
- `names` — an array of fully-qualified names (`["Payment.Pending", "Payment.Failed", ...]`)
- Dynamic string-literal accessors — `Payment.Pending === "Payment.Pending"`

## Spreading into a Workflow

<<< @/snippets/guide/state-groups.ts#spread-into-config

After the spread, `"Payment.Pending"`, `"Payment.Failed"`, and `"Payment.Retrying"` are first-class states alongside `"Draft"` and `"Shipped"`. `StateNames<TConfig>` includes them all.

## Handlers on a Specific Sub-State

Pass the string-literal accessor (e.g. `Payment.Pending`) to `router.state()`. Inside the handler, `ctx.data` has the child's full inferred type — including any base fields you spread in.

<<< @/snippets/guide/state-groups.ts#sub-state-handler

## Handlers on the Whole Group

Pass `group.names` to `router.state()` to register a handler that fires in every sub-state. Inside the handler, `ctx.data` is the union of all sub-state data types — fields shared across every child (because you spread the same base into all of them) are directly accessible, but child-specific fields require `ctx.match()` to narrow.

<<< @/snippets/guide/state-groups.ts#group-handler

**Note on `match()` inside a group handler:** `match()` is typed against the workflow's full `StateNames`, not just the group's sub-states. Even though your handler only runs inside `Payment.*` at runtime, you still need the fallback form `match(matchers, () => ...)` to satisfy the type checker. The fallback branch will never be hit in practice.

Sub-state-specific handlers take priority over group-wide handlers. If a command matches both, only the sub-state-specific one runs.

## Transitioning

Transitions work exactly as they do for flat states. `transition("Payment.Failed", data)` validates `data` against the child's schema — whatever base fields you spread in are required, plus the child's own fields.

## Using `state()` Configs Inside a Group

Group children can be `state({ schema, clientSchema })` entries, not just plain schemas. This composes naturally when a sub-state needs server-only fields:

```ts
const Payment = defineGroup("Payment", {
    Pending: z.object({ ...basePayment, attempt: z.number() }),
    Failed: state({
        schema: z.object({
            ...basePayment,
            reason: z.string(),
            internalErrorCode: z.string(), // server-only
        }),
        clientSchema: z.object({ ...basePayment, reason: z.string() }),
    }),
});
```

## When NOT to Use Groups

- **No repeated naming** — just use flat states. Groups only pay off when you have several closely related states you want to handle together.
- **Full statechart semantics** — rytejs doesn't support entry/exit actions, history pseudo-states, or automatic parent-handler fallthrough on missed commands. Groups are a naming mechanism, not a hierarchical state machine.

## Limitations

- Groups are flat — a child cannot itself be a group
- Spreading into `states` follows JS object-spread semantics — a later key overwrites an earlier one silently
- Shared base fields are a consumer concern — validator-native spread/merge, not a framework feature
