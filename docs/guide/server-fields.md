# Server Fields

State data sometimes contains fields that must never reach the client — API keys, SSNs, internal scores. Declare them in a `state({ schema, server: [...] })` entry and the framework strips them at serialization time and excludes them from client TypeScript types.

The `server` declaration is **validator-agnostic** — it's a list of field names, not a schema wrapper, so it works identically with Zod, Valibot, and ArkType.

## Declaring Server Fields

Wrap a state's schema with `state()` and list the server-only field names. The names are type-checked against `keyof` of the schema's inferred output — typos are caught at compile time.

<<< @/snippets/guide/server-fields.ts#marking

States without server fields can still be plain schemas — `state()` is only needed when you have fields to strip.

## Serializing for Clients

`serialize()` always returns the full snapshot for server-side persistence. `serializeForClient()` strips the declared server fields from the data:

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

## Client Definitions

`definition.forClient()` returns a `ClientWorkflowDefinition` — a client-safe projection of the workflow. Its `deserialize()` accepts trusted snapshots from the server without re-validating the data shape:

<<< @/snippets/guide/server-fields.ts#client-definition

The client definition is memoized — `forClient()` returns the same instance on repeated calls.

> **No client-side schema validation.** The client definition does not rebuild a stripped schema (rebuilding would require validator-specific APIs and couple rytejs to Zod). If you need defence-in-depth validation on the client, pass the received snapshot through your own client-side schema before calling `deserialize`.

## Type Safety

`ClientStateData` omits declared server fields at compile time. Client code that tries to access a server-only field gets a compile error:

<<< @/snippets/guide/server-fields.ts#type-safety

## Edge Cases

- **No declared server fields** — `serializeForClient()` returns the same data as `serialize()`. Adoption is incremental — a state with no server fields can stay as a plain schema.
- **All fields declared as server** — client sees `{}`. It knows the workflow's state but not the data.
- **Nested fields** — only top-level keys are supported in `server: [...]` today. To hide a nested field, wrap the surrounding object in its own `state()` with its own `server` list, or restructure so the sensitive field lives at a top level you can strip.

## Migration from `server()` wrapper

Earlier versions exported a `server()` function that branded Zod schemas inline. That approach was Zod-specific and coupled rytejs to Zod internals for runtime stripping. The declarative list replaces it:

```typescript
// Before (removed)
Review: z.object({
    applicantName: z.string(),
    ssn: server(z.string()),
    creditScore: server(z.number()),
})

// After
Review: state({
    schema: z.object({
        applicantName: z.string(),
        ssn: z.string(),
        creditScore: z.number(),
    }),
    server: ["ssn", "creditScore"],
})
```

Client types (`ClientStateData<Config, "Review">`) are identical after the change.
