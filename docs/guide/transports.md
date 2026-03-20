# Transports

Your server pushes updates. Now connect from the client.

## The Transport Interface

A `Transport` has two methods: `dispatch` sends commands to the server, `subscribe` listens for server-pushed updates:

<<< @/snippets/guide/transports.ts#transport-interface

## SSE Transport

`sseTransport` uses POST for dispatch and EventSource for subscribe — low latency with automatic reconnection:

<<< @/snippets/guide/transports.ts#sse-transport

## Polling Transport

`pollingTransport` uses POST for dispatch and interval polling for subscribe. Only fires the callback when the version changes:

<<< @/snippets/guide/transports.ts#polling-transport

## WebSocket Transport

<<< @/snippets/guide/transports.ts#ws-transport

## When to Use Which

| | SSE | Polling | WebSocket |
| --- | --- | --- | --- |
| **Latency** | Low (push) | High (interval) | Lowest (full-duplex) |
| **Complexity** | Low | Lowest | Highest |
| **Browser support** | All modern | All | All modern |
| **Server requirements** | Long-lived connections | Stateless | Upgrade support |
| **Best for** | Most use cases | Simple setups, serverless | High-frequency updates |

## Error Handling

`TransportResult` follows the same result pattern. Transport-level errors use the `transport` category with specific codes:

<<< @/snippets/guide/transports.ts#error-handling
