# Serialization

Workflows can be serialized to plain JSON-safe objects and restored with validation. This enables persistence, transfer, and migration without coupling to any storage layer.

## Snapshotting

`definition.serialize()` converts a workflow into a plain object:

<<< @/snippets/guide/serialization.ts#snapshot

The snapshot is `JSON.stringify`-safe — no classes, symbols, or circular references. Dates (`createdAt`, `updatedAt`) are serialized as ISO 8601 strings.

## Restoring

`definition.deserialize()` validates a snapshot against the current schemas and reconstructs the workflow:

<<< @/snippets/guide/serialization.ts#restore

Validation catches:
- **Unknown states** — the snapshot references a state not in the current definition
- **Schema mismatches** — the data doesn't match the state's Zod schema

## Persistence

Persistence is userland — the snapshot is just an object. Store it however you want:

<<< @/snippets/guide/serialization.ts#persistence

## Model Versioning

Every definition has a `modelVersion` (defaults to 1). It's stamped on every snapshot:

<<< @/snippets/guide/serialization.ts#model-version

When your state schemas change, bump the `modelVersion`. Before restoring old snapshots, check the version and migrate:

<<< @/snippets/guide/serialization.ts#version-check

For migrating old snapshots to the current schema version, see the [Migrations](/guide/migrations) guide. The core provides `defineMigrations()` and `migrate()` for building migration pipelines.
