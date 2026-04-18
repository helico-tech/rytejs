# Server Fields

State data sometimes contains fields that must never reach the client — API keys, SSNs, internal scores. Declare a second `clientSchema` alongside the state's full schema, and the framework uses it to produce client-safe snapshots and client TypeScript types.

The approach is **validator-agnostic** — both schemas are plain Standard Schema validators. The framework never inspects their shape; stripping happens through each validator's own default-strip behaviour.

## Declaring Server and Client Schemas

Wrap a state in `state()` with `schema` (full/server-side) and `clientSchema` (client-safe). Both are ordinary validator instances.

<<< @/snippets/guide/server-fields.ts#marking

States without sensitive fields can still be plain schemas — `state()` is only needed when the server and client views diverge.

## Serializing for Clients

`serialize()` always returns the full snapshot for server-side persistence. `serializeForClient()` runs data through `clientSchema.validate()` and returns the result — unknown keys (those absent from `clientSchema`) are stripped by the validator's default behaviour.

<<< @/snippets/guide/server-fields.ts#serialize

A typical integration pattern persists the full snapshot and broadcasts the stripped one:

```typescript
if (result.ok) {
	// Persist full snapshot
	await storage.put(definition.serialize(result.workflow));

	// Broadcast stripped snapshot to clients
	broadcast(definition.serializeForClient(result.workflow));
}
```

> **Strict validators:** Zod and Valibot strip unknown keys by default; this "just works." **ArkType is strict by default** — if you use ArkType for `clientSchema`, write it in loose mode (e.g. `type({ "+": "ignore", applicantName: "string" })`) or `serializeForClient()` will throw.

## Client Definitions

`definition.forClient()` returns a `ClientWorkflowDefinition` — a projection that validates incoming snapshots against the declared `clientSchema`. This restores defence-in-depth: a corrupted or malicious client-side snapshot is rejected before you reconstruct the workflow.

<<< @/snippets/guide/server-fields.ts#client-definition

The client definition is memoized — `forClient()` returns the same instance on repeated calls.

When a state has **no** `clientSchema`, `deserialize()` passes data through unchanged (state-name check only) — there's no client/server divergence to validate.

## Type Safety

`ClientStateData` infers from `clientSchema` when declared, falling back to the server schema otherwise. Client code that tries to access a server-only field gets a compile error.

<<< @/snippets/guide/server-fields.ts#type-safety

## Edge Cases

- **No `clientSchema` declared** — `serializeForClient()` returns the same data as `serialize()`. Adoption is incremental — a state with no server/client divergence can stay as a plain schema.
- **Empty `clientSchema`** — Zod/Valibot `object({})` strips everything, yielding `{}`. Client knows the workflow's state but not the data.
- **Nested sensitive fields** — express them inside the clientSchema explicitly (e.g. `clientSchema: z.object({ applicant: z.object({ name: z.string() }) })` to keep `applicant.name` but drop `applicant.ssn`). The consumer controls the client shape entirely.

## Migration from the `server()` wrapper

Earlier versions exported a `server(schema)` function that branded Zod schemas inline, and a later iteration used a `server: ["key1", "key2"]` key list. Both approaches were replaced by the two-schema model, which avoids introspecting schema shape:

```typescript
// Old (removed): inline brand
Review: z.object({
    applicantName: z.string(),
    ssn: server(z.string()),
})

// Old (removed): key list
Review: state({
    schema: z.object({ applicantName: z.string(), ssn: z.string() }),
    server: ["ssn"],
})

// Current: two schemas
Review: state({
    schema: z.object({ applicantName: z.string(), ssn: z.string() }),
    clientSchema: z.object({ applicantName: z.string() }),
})
```

Client types (`ClientStateData<Config, "Review">`) and runtime output are equivalent after the change, but the current form makes the client contract explicit and expressible in any validator that supports Standard Schema.
