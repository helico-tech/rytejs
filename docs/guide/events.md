# Events

Events are side effects emitted during dispatch. They are schema-validated, accumulated per dispatch, and returned in the result.

## Emitting Events

Use `emit()` inside a handler. The event data is validated against the event's Zod schema.

<<< @/snippets/guide/events.ts#emit

You can emit multiple events in a single handler:

<<< @/snippets/guide/events.ts#emit-multiple

## Reading Events After Dispatch

Events are returned in `result.events` on success:

<<< @/snippets/guide/events.ts#read-events

## Schema Validation

Event data must match the schema defined in the workflow. If it doesn't, dispatch fails with a validation error:

<<< @/snippets/guide/events.ts#schema-validation

This produces a validation error with `source: "event"`.

## Per-Dispatch Isolation

Each dispatch starts with an empty events list. Events from one dispatch never appear in another.

<<< @/snippets/guide/events.ts#per-dispatch

## Handling Events

Ryte does not prescribe how you handle events after dispatch. Common patterns:

<<< @/snippets/guide/events.ts#handling

Events are data -- publish them to a message bus, write them to an event store, or handle them inline. Ryte gives you validated, typed events and lets you decide what to do with them.
