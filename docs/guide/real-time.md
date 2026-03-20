# Real-time

Your executor saves state. Now push changes to connected clients.

## SubscriberRegistry

`createSubscriberRegistry()` creates an in-memory pub/sub hub. Subscribers register for a specific workflow ID and receive broadcasts when that workflow changes:

<<< @/snippets/guide/real-time.ts#subscriber-registry

## withBroadcast

The `withBroadcast` middleware notifies subscribers after a successful save:

<<< @/snippets/guide/real-time.ts#with-broadcast

## Middleware Ordering

`withBroadcast` must wrap `withStore` (added first, runs as outer middleware). This ensures the version is set by `withStore` before the broadcast fires:

<<< @/snippets/guide/real-time.ts#middleware-ordering

## BroadcastMessage

When a subscriber is notified, it receives a `BroadcastMessage` with three fields:

| Field | Type | Description |
| --- | --- | --- |
| `snapshot` | `WorkflowSnapshot` | The full workflow snapshot after the operation |
| `version` | `number` | The new version number (set by `withStore`) |
| `events` | `Array<{ type, data }>` | Domain events emitted during dispatch |

## SSE Endpoint

`handleSSE` creates a streaming response that pushes updates via Server-Sent Events:

<<< @/snippets/guide/real-time.ts#handle-sse

The client connects with `EventSource` and receives JSON messages with `{ snapshot, version, events }`. The connection automatically cleans up when the client disconnects.

## Polling Endpoint

`handlePolling` returns the current workflow state. Clients detect changes by comparing the version number:

<<< @/snippets/guide/real-time.ts#handle-polling

## Wiring It Up

Combine the executor, store, broadcast, and real-time endpoints into a full server:

<<< @/snippets/guide/real-time.ts#wiring
