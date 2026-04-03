# Server Fields Documentation

**Date:** 2026-04-03
**Status:** Draft

## Overview

Add a "Server Fields" guide page documenting the `server()` marker, `serializeForClient()`, `forClient()`, and client type utilities. Follows existing doc patterns: markdown page with compilable snippet regions.

## Deliverables

### 1. Guide Page: `docs/guide/server-fields.md`

Placed after Serialization in the Advanced section of the sidebar.

**Sections:**

#### Intro (2-3 sentences)
State data sometimes contains fields that must never reach the client — API keys, SSNs, internal scores. The `server()` marker declares fields as server-only. The framework strips them at serialization time and excludes them from client TypeScript types.

#### Marking Fields
- `server()` wraps any Zod schema to mark it as server-only
- Works at any depth in `z.object()` (nested objects)
- Does not mutate the original schema
- Snippet: definition with `server()` fields

#### Serializing for Clients
- `serialize()` always returns the full snapshot (for persistence)
- `serializeForClient()` strips server fields from the data
- Snippet: side-by-side comparison of both methods
- Integration pattern: persist full, broadcast stripped

#### Client Definitions
- `definition.forClient()` returns a `ClientWorkflowDefinition`
- Client schemas have server fields removed — `deserialize()` validates against them
- Memoized — same instance on repeated calls
- Snippet: creating a client definition, deserializing a client snapshot

#### Type Safety
- `ClientStateData<TConfig, State>` omits server fields at compile time
- Client code gets compile errors when accessing server-only fields
- Snippet: type-level demonstration

#### Edge Cases (brief, no snippet)
- No `server()` fields → `serializeForClient()` returns same data as `serialize()`
- All fields `server()` → client sees `{}` (knows the state but not the data)
- `server()` only applies to `z.object()` fields — to hide an entire array, wrap it: `items: server(z.array(...))`

### 2. Snippet File: `docs/snippets/guide/server-fields.ts`

Compilable TypeScript file with `#region` markers. Uses tab indentation. Imports from `@rytejs/core`.

Regions:
- `#marking` — `defineWorkflow` with `server()` fields, including nested
- `#serialize` — `serialize()` vs `serializeForClient()` comparison
- `#client-definition` — `forClient()`, `deserialize()`, `getStateSchema()`
- `#type-safety` — `ClientStateData` usage with type narrowing

### 3. Sidebar Update: `docs/.vitepress/config.ts`

Add `{ text: "Server Fields", link: "/guide/server-fields" }` after the Serialization entry in the Advanced section.

### 4. Serialization Page Cross-Reference

Add a one-line note at the end of `docs/guide/serialization.md` (before the migrations link) pointing to the Server Fields page for stripping sensitive data before sending to clients.

## Non-Goals

- No changes to the React guide page (React integration with `forClient()` can be a follow-up)
- No API reference updates (those are TypeDoc-generated)
- No changes to examples
