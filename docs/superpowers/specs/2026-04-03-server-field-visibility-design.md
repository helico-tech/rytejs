# Server Field Visibility

**Date:** 2026-04-03
**Status:** Draft
**Motivation:** Security/compliance — prevent sensitive fields (SSN, API keys, internal scores) from reaching the client, even via WebSocket inspection.

## Overview

Workflow state data often contains fields that must never leave the server. Today, `serialize()` and `BroadcastMessage` send the complete snapshot to all clients with no filtering. This design adds a `server()` schema marker that declares fields as server-only, and the framework enforces stripping at serialization time with full TypeScript type safety on both sides.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Motivation | Security/compliance | Fields must never reach the browser, not just hidden in UI |
| Filtering boundary | Schema-level declaration, framework enforces | Opt-in transport filtering is forgettable; schema declaration makes it structural |
| Definition model | One definition, two projections | Single source of truth, no drift between server/client schemas |
| Client schema shape | Server fields removed entirely | Not optional — removed from both data and TypeScript types |
| Serialization API | Separate `serializeForClient()` method | `serialize()` stays unchanged (full, for persistence). Dedicated method is greppable and impossible to misuse |
| Visibility granularity | Binary (visible / server-only) | YAGNI. Multi-audience (`visible(["admin", "user"])`) can be added later without rewriting |
| Implementation approach | Dual-schema derivation | Pre-computes both full and client schemas/types at definition time |

## The `server()` Marker

### API

```typescript
import { server } from "@rytejs/core";
import { z } from "zod";

const def = defineWorkflow("loan", {
	states: {
		Review: z.object({
			applicantName: z.string(),
			ssn: server(z.string()),
			internalScore: server(z.number()),
		}),
		Approved: z.object({
			applicantName: z.string(),
			approvedAmount: z.number(),
			underwriterNotes: server(z.string()),
		}),
	},
	commands: { /* ... */ },
	events: { /* ... */ },
	errors: { /* ... */ },
});
```

### Implementation

`server()` uses Zod v4's `.meta()` to attach metadata and a type-level brand for TypeScript discrimination:

```typescript
type Server<T extends ZodType> = T & { readonly _server: true };

function server<T extends ZodType>(schema: T): Server<T> {
	return schema.meta({ ryte: { server: true } }) as Server<T>;
}

function isServerField(schema: ZodType): boolean {
	const meta = schema.meta();
	return meta?.ryte?.server === true;
}
```

- `.meta()` provides runtime identification (idiomatic Zod v4)
- `_server` type brand provides compile-time identification (doesn't affect `z.infer`)
- The original Zod schema is preserved — validation behavior is unchanged

### Nesting

`server()` works at any depth within `z.object()`:

```typescript
Review: z.object({
	applicant: z.object({
		name: z.string(),
		ssn: server(z.string()),   // stripped from client type
	}),
})
// Client type: { applicant: { name: string } }
```

Top-level `server()` on an entire state schema is **not supported** — every state must have a client representation (even if it's `{}`).

## Type System

### Pre-computed Projections

`defineWorkflow` already pre-computes `_resolved` for IDE completion. This design adds `_clientResolved`:

```typescript
export function defineWorkflow<const TConfig extends WorkflowConfigInput>(
	name: string,
	config: TConfig,
): WorkflowDefinition<
	TConfig & {
		_resolved: {
			states: { [K in keyof TConfig["states"]]: z.infer<TConfig["states"][K]> };
			// ... commands, events, errors unchanged
		};
		_clientResolved: {
			states: { [K in keyof TConfig["states"]]: StripServerFields<TConfig["states"][K]> };
		};
	}
>;
```

### Type Utilities

```typescript
// Extracts the client-safe inferred type by omitting server-branded fields
type StripServerFields<T extends ZodType> = /* ... recursive mapped type ... */

// Existing — full state data (server-side handlers)
type StateData<T extends WorkflowConfig, S extends StateNames<T>> =
	Prettify<T["_resolved"]["states"][S]>;

// New — client-safe state data (React components)
type ClientStateData<T extends WorkflowConfig, S extends StateNames<T>> =
	Prettify<T["_clientResolved"]["states"][S]>;

// Client-side workflow (uses ClientStateData instead of StateData)
type ClientWorkflow<TConfig extends WorkflowConfig> = {
	[S in StateNames<TConfig>]: ClientWorkflowOf<TConfig, S>;
}[StateNames<TConfig>];
```

### `StripServerFields` Type

Operates on the Zod schema type to compute the client-safe inferred type:

```typescript
// For z.object schemas: omit keys whose schema is Server<T>, recurse into remaining
type StripServerFields<T extends ZodType> =
	T extends z.ZodObject<infer Shape>
		? z.infer<z.ZodObject<{
				[K in keyof Shape as Shape[K] extends Server<any> ? never : K]:
					Shape[K] extends z.ZodObject<any> ? /* recurse */ : Shape[K]
			}>>
		: z.infer<T>;
```

The exact implementation may need adjustment for Zod v4's internal type structure, but the principle is: filter out `_server`-branded keys and recurse into nested objects.

## Definition API

### `serializeForClient()`

New method on `WorkflowDefinition` — strips `server()` fields from the snapshot data:

```typescript
export interface WorkflowDefinition<TConfig extends WorkflowConfig> {
	// Existing
	serialize(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	deserialize(snapshot: WorkflowSnapshot<TConfig>): /* ... */;

	// New
	serializeForClient(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
	forClient(): ClientWorkflowDefinition<TConfig>;
}
```

**`serializeForClient(workflow)`** — Returns a `WorkflowSnapshot` with `server()` fields stripped from `data`. Used by server transport code when broadcasting to clients.

**Runtime behavior:** Walks the state's Zod schema, identifies fields with `ryte.server` metadata, and omits them from the serialized `data` object. Recursive for nested `z.object()` schemas.

### `forClient()`

Returns a `ClientWorkflowDefinition` — a client-safe projection of the definition:

```typescript
export interface ClientWorkflowDefinition<TConfig extends WorkflowConfig> {
	readonly config: TConfig;
	readonly name: string;
	deserialize(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: ClientWorkflow<TConfig> } | { ok: false; error: ValidationError };
	getStateSchema(stateName: string): ZodType; // returns client schema (server fields removed)
	hasState(stateName: string): boolean;
}
```

- State schemas have `server()` fields removed — `deserialize()` validates against stripped schemas
- No `createWorkflow`, `serialize`, or command/event schema methods — clients don't need them
- TypeScript types use `ClientStateData` — `data.ssn` is a compile error
- **Memoized:** repeated calls return the same instance

The client schema derivation happens once at `forClient()` call time. It walks each state's Zod schema, creates a new `z.object()` with server fields omitted, and caches the result.

## Server-Side Usage

```typescript
// In Cloudflare Durable Object (or any server transport)
const result = router.dispatch(workflow, command);

if (result.ok) {
	// Persist full snapshot
	const snapshot = definition.serialize(result.workflow);
	await storage.put(snapshot);

	// Broadcast stripped snapshot to clients
	const clientSnapshot = definition.serializeForClient(result.workflow);
	this.broadcast({
		snapshot: clientSnapshot,
		version: snapshot.version,
		events: result.events,
	});
}
```

## Client-Side Usage

```typescript
// React application
import { def } from "../shared/loan.js";
import { createClientStore } from "@rytejs/react";

const clientDef = def.forClient();
const store = createClientStore(clientDef, transport);

// In component
const { data, match } = useWorkflow(store);
data.applicantName;  // ✅ string
data.ssn;            // ❌ compile error — not in ClientStateData

match({
	Review: (data) => {
		data.applicantName;    // ✅
		data.internalScore;    // ❌ compile error
	},
	Approved: (data) => {
		data.approvedAmount;      // ✅
		data.underwriterNotes;    // ❌ compile error
	},
});
```

## React Package Changes

The `@rytejs/react` package types need to accept `ClientWorkflowDefinition`:

- `createClientStore()` accepts `ClientWorkflowDefinition<TConfig>` (in addition to full `WorkflowDefinition<TConfig>`)
- `WorkflowStore`, `UseWorkflowReturn`, and `match()` use `ClientWorkflow<TConfig>` / `ClientStateData<TConfig, S>` when constructed from a client definition
- `dispatch()` continues to work — commands are sent to the server, which has the full definition

The exact generic plumbing depends on whether `createClientStore` is overloaded or uses a union. This will be resolved during implementation.

## Edge Cases

### No `server()` fields

If a workflow definition has no `server()` fields, `serializeForClient()` returns the same data as `serialize()`. `forClient()` returns a definition with identical schemas. No error, no warning. Adoption is incremental.

### All fields are `server()`

A state where every field is `server()` results in a client type of `{}` and client data of `{}`. This is valid — the client knows the workflow is in that state but sees no data.

### Arrays and unions

`server()` only applies to `z.object()` fields. It cannot be used on array elements or union variants. If you need to hide an entire array, wrap it: `items: server(z.array(z.string()))`.

## Future Extension: Multi-Audience

The binary `server()` marker can later be extended to named audiences without breaking changes:

```typescript
// Future (additive)
visible(["admin", "user"], z.string())   // visible to specific audiences
server(z.string())                        // sugar for "no audience"

definition.serializeFor("admin", workflow)
definition.forAudience("admin")
```

`server()` would remain valid as the "never send to any client" marker. `serializeForClient()` and `forClient()` would continue to work as the "strip everything not public" path.
