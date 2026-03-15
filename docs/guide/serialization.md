# Serialization

Workflows can be serialized to plain JSON-safe objects and restored with validation. This enables persistence, transfer, and migration without coupling to any storage layer.

## Snapshotting

`definition.snapshot()` converts a workflow into a plain object:

```ts
const wf = definition.createWorkflow("order-1", {
	initialState: "Placed",
	data: { items: ["apple"], placedAt: new Date() },
});

const snap = definition.snapshot(wf);
// {
//   id: "order-1",
//   definitionName: "order",
//   state: "Placed",
//   data: { items: ["apple"], placedAt: "2026-03-14T..." },
//   createdAt: "2026-03-14T10:00:00.000Z",
//   updatedAt: "2026-03-14T10:00:00.000Z",
//   modelVersion: 1,
// }
```

The snapshot is `JSON.stringify`-safe — no classes, symbols, or circular references. Dates (`createdAt`, `updatedAt`) are serialized as ISO 8601 strings.

## Restoring

`definition.restore()` validates a snapshot against the current schemas and reconstructs the workflow:

```ts
const result = definition.restore(snap);

if (result.ok) {
	// result.workflow is a fully typed Workflow<TConfig>
	// Dates are reconstructed from ISO strings
	console.log(result.workflow.createdAt instanceof Date); // true
} else {
	// result.error is a ValidationError with source: "restore"
	console.log(result.error.issues);
}
```

Validation catches:
- **Unknown states** — the snapshot references a state not in the current definition
- **Schema mismatches** — the data doesn't match the state's Zod schema

## Persistence

Persistence is userland — the snapshot is just an object. Store it however you want:

```ts
// Save
const snap = definition.snapshot(workflow);
await db.put(`workflow:${snap.id}`, JSON.stringify(snap));

// Load
const json = await db.get(`workflow:${workflow.id}`);
const result = definition.restore(JSON.parse(json));
```

## Model Versioning

Every definition has a `modelVersion` (defaults to 1). It's stamped on every snapshot:

```ts
const definition = defineWorkflow("order", {
	modelVersion: 2,
	states: { ... },
	commands: { ... },
	events: { ... },
	errors: { ... },
});

const snap = definition.snapshot(wf);
snap.modelVersion; // 2
```

When your state schemas change, bump the `modelVersion`. Before restoring old snapshots, check the version and migrate:

```ts
const snap = JSON.parse(stored);

if (snap.modelVersion === 1) {
	// Transform v1 data to v2 shape
	snap.data = migrateV1toV2(snap.data);
	snap.modelVersion = 2;
}

const result = definition.restore(snap);
```

For migrating old snapshots to the current schema version, see the [Migrations](/guide/migrations) guide. The core provides `defineMigrations()` and `migrate()` for building migration pipelines.
