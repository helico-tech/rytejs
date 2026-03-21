# Space Mission Control

Full-stack @rytejs example with Bun, Redis, and React.

Demonstrates a complete workflow-driven application: a space mission progresses through
Planning, Countdown, Ascending, OrbitAchieved (and error paths like Scrubbed, AbortSequence,
Cancelled) — all modeled as a type-safe @rytejs workflow.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for Redis)
- [Bun](https://bun.sh/) >= 1.2
- [pnpm](https://pnpm.io/) >= 9

## Quick Start

```bash
# Start Redis
docker compose up -d

# Install dependencies
pnpm install

# Start the server (port 4000)
bun run dev:server

# In another terminal — start the client (port 5173)
pnpm run dev:client
```
