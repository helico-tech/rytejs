# Mission Control — Cloudflare Workers + Durable Objects

Cloudflare Workers + Durable Objects version of the mission-control example for `@rytejs`.

Each mission is a **Durable Object** instance that holds a `WorkflowExecutor` backed by DO storage. Countdown ticking and telemetry tracking use the DO `alarm()` API instead of `setInterval`. Real-time updates are delivered over **WebSocket** (DOs support WebSocket natively via the hibernation API).

## Prerequisites

- Node.js 18+
- Cloudflare account (for deploy only — local dev uses `wrangler dev`)

## Development

```bash
pnpm install
pnpm run build:client   # Build the React frontend
pnpm run dev             # Start wrangler dev (local mode)
```

Or build + dev in one step:

```bash
pnpm run preview
```

## Deploy

```bash
pnpm run deploy
```

## Architecture

| Bun version | Cloudflare version |
|---|---|
| In-memory store | DO storage per instance |
| `setInterval` loops | `alarm()` scheduling |
| SSE (EventSource) | WebSocket (DO hibernation API) |
| Bun HTTP server | Cloudflare Worker fetch handler |
| Broadcast manager | DO broadcasts directly to WebSockets |
| Server-side mission list | Client-side localStorage index |
