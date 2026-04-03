# Server Fields

State data sometimes contains fields that must never reach the client — API keys, SSNs, internal scores. The `server()` marker declares fields as server-only, and the framework strips them at serialization time and excludes them from client TypeScript types.

## Marking Fields

Wrap any Zod schema with `server()` to mark it as server-only. It works at any nesting depth within `z.object()`:

<<< @/snippets/guide/server-fields.ts#marking

The original schema is not mutated — `server()` returns a new reference, so shared schemas are safe.

## Serializing for Clients

`serialize()` always returns the full snapshot for server-side persistence. `serializeForClient()` strips server fields from the data:

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

`definition.forClient()` returns a `ClientWorkflowDefinition` — a client-safe projection where state schemas have server fields removed. Its `deserialize()` validates against the stripped schemas:

<<< @/snippets/guide/server-fields.ts#client-definition

The client definition is memoized — `forClient()` returns the same instance on repeated calls.

## Type Safety

`ClientStateData` omits server fields at compile time. Client code that tries to access a server-only field gets a compile error:

<<< @/snippets/guide/server-fields.ts#type-safety

## Edge Cases

- **No `server()` fields** — `serializeForClient()` returns the same data as `serialize()`. Adoption is incremental.
- **All fields `server()`** — client sees `{}`. It knows the workflow's state but not the data.
- **Arrays and non-objects** — `server()` only applies to `z.object()` fields. To hide an entire array, wrap it: `items: server(z.array(z.string()))`.
