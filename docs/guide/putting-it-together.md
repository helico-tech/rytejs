# Putting It Together

You've built the pieces. Here's the full picture — and why it looks a lot like a Durable Object.

## Full Server

A complete server with executor, persistence, broadcasting, and real-time in ~20 lines:

<<< @/snippets/guide/putting-it-together.ts#full-server

## Full Client

Connect from the client with a transport-backed store:

<<< @/snippets/guide/putting-it-together.ts#full-client

## What You Built

```
Client → Transport → HTTP API → Executor Pipeline → Store/Broadcast → Client
         (SSE/Poll)   (createFetch)  (withBroadcast → withStore → core)
```

Each layer is independent and composable. You can use the executor without HTTP, HTTP without real-time, or real-time without a client transport.

## Comparison with Durable Objects

| Concern | Ryte | Durable Objects |
| --- | --- | --- |
| **Single-threaded execution** | Optimistic concurrency (no actor model, but same safety guarantee) | Single-threaded actor per ID |
| **Persistent state** | Store adapter + outbox pattern | Built-in transactional storage |
| **Real-time** | SSE/polling via SubscriberRegistry | WebSocket pairs |
| **Portability** | Node, Deno, Bun, Cloudflare, edge | Cloudflare only |
| **Type-safe commands** | Zod validation + discriminated unions | Raw messages |

## What DOs Give You (That Ryte Doesn't Yet)

- **Automatic placement** — DOs are created at the edge, close to the user
- **Hibernation** — DOs sleep when idle and wake on request
- **Alarms** — scheduled execution without external cron
- **Global uniqueness guarantee** — platform ensures exactly one instance per ID

These could be added as executor middleware or platform-specific adapters.

## What Ryte Gives You (That DOs Don't)

- **Pure domain logic** — handlers have no IO, easier to test and reason about
- **Composable middleware** — add persistence, broadcast, tracing with `.use()`
- **Schema migrations** — evolve stored state safely with migration pipelines
- **Pluggable transports** — SSE, polling, WebSocket — swap without changing business logic
- **Framework-agnostic** — run on any runtime, deploy anywhere
