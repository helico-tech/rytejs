# Space Mission Control

Full-stack @rytejs example with Bun and React.

Demonstrates a complete workflow-driven application: a space mission progresses through
Planning, Countdown, Ascending, OrbitAchieved (and error paths like Scrubbed, AbortSequence,
Cancelled) — all modeled as a type-safe @rytejs workflow.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.2
- [pnpm](https://pnpm.io/) >= 9

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the server (port 4000)
bun run dev:server

# In another terminal — start the client (port 5173)
pnpm run dev:client
```

## Architecture

```
shared/          Workflow definition (shared between server & client)
server/          Bun HTTP server with in-memory store, SSE broadcast, background loops
client/          React + Vite UI
```

### Server

- **In-memory store** — hash/set data structures that mimic Redis semantics (no external dependencies)
- **SSE broadcast** — in-process pub/sub fans out state changes to connected clients
- **WorkflowExecutor** — dispatches commands through the @rytejs router with optimistic concurrency
- **Background loops** — countdown timer and telemetry tracking run on intervals

### Client

- React with Vite
- EventSource (SSE) for real-time updates
- Calls the REST API to dispatch commands

## API

| Method | Path                      | Description              |
| ------ | ------------------------- | ------------------------ |
| GET    | `/missions`               | List all missions        |
| PUT    | `/missions/:id`           | Create a mission         |
| POST   | `/missions/:id`           | Dispatch a command       |
| GET    | `/missions/:id`           | Get mission snapshot     |
| GET    | `/missions/events`        | SSE stream (list)        |
| GET    | `/missions/:id/events`    | SSE stream (single)     |
