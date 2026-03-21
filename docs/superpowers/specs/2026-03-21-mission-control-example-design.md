# Mission Control Full-Stack Example — Design Spec

## Overview

A full-stack example demonstrating @rytejs in a real-world scenario: a Space Mission Control system with a Bun + Redis server, React frontend, server-only dependencies, real-time sync via SSE, and optimistic concurrency. The example lives in `examples/mission-control/` as a standalone project.

## Goals

1. **Showcase the full Ryte stack** — definition, router, executor, store adapter, middleware, events, and the new `createWorkflowClient` API
2. **Demonstrate server-only dependencies** — a `TelemetryService` that only exists on the server; the frontend never touches it
3. **Real-time sync** — server broadcasts state changes via Redis pub/sub → SSE; frontend updates live
4. **Concurrency** — multiple clients dispatching against the same mission; optimistic locking via `expectedVersion`
5. **Autonomous server behavior** — a background tracking loop that pushes telemetry updates to ascending missions
6. **Production-like architecture** — Redis persistence, stateless server, clean client/server separation

## Non-Goals

- Not a production-ready deployment template (no auth, no HTTPS, no rate limiting)
- Not a distributed systems demo (single Bun server, no clustering)
- Not a WebSocket implementation (SSE + fetch is sufficient)

---

## Library Change: `@rytejs/react`

### Problem

`createWorkflowStore` currently mixes two concerns: local workflow execution (via router) and remote workflow proxying (via transport). When using transport, the router is unused — you must create an empty `WorkflowRouter` just to satisfy the type signature. This conflation is confusing.

### Solution

**Separate local and remote into distinct APIs:**

- **`createWorkflowStore(router, initialConfig, options?)`** — Local-only. Dispatches through the router. Optional `localStorage` persistence. No transport support. The workflow *lives* in the browser.
- **`createWorkflowClient(transport)`** — Remote proxy. Returns a client with `.connect(definition, id)` that creates a store backed by transport. The workflow *lives* on the server.

Both return a `WorkflowStore<TConfig>` that works with `useWorkflow()`.

### Changes to `@rytejs/react`

1. **Remove** `transport` from `WorkflowStoreOptions`
2. **Remove** all transport dispatch/subscribe/cleanup logic from `createWorkflowStore`
3. **Add** `createWorkflowClient(transport)` function:

```ts
export function createWorkflowClient(transport: Transport) {
	return {
		connect<TConfig extends WorkflowConfig>(
			definition: WorkflowDefinition<TConfig>,
			id: string,
		): WorkflowStore<TConfig> {
			// Creates a store where:
			// - dispatch() calls transport.dispatch()
			// - subscribe() connects to transport.subscribe(id)
			// - restore() uses definition.restore()
			// - No local router needed
		},
	};
}
```

4. **Update** exports in `index.ts` — add `createWorkflowClient`
5. **Update** `transport-store.test.ts` — tests move to exercise `createWorkflowClient` instead
6. **Keep** `Transport`, `TransportResult`, `TransportError`, `TransportSubscription`, `BroadcastMessage` type exports

### Usage

```ts
// Browser-only: workflow runs here
const store = createWorkflowStore(router, { state: "Todo", data });

// Server-backed: workflow runs on server
const client = createWorkflowClient(transport);
const mission = client.connect(missionDef, "mission-1");

// Both work with useWorkflow()
const wf = useWorkflow(mission);
```

---

## Domain: Space Mission Control

### Workflow Definition (`shared/mission.ts`)

Shared between server and client. Contains only Zod schemas — no server deps.

#### States

| State | Data Fields |
|-------|-------------|
| Planning | name, destination, crewMembers: string[], fuelLevel: number |
| Countdown | ...Planning + countdownStartedAt: Date, telemetryStatus: "go" \| "no-go" |
| Scrubbed | name, destination, crewMembers, fuelLevel, scrubbedAt: Date, reason: string, attemptNumber: number |
| Ascending | ...Countdown + launchedAt: Date, altitude: number, velocity: number, heading: number, telemetryReadings: TelemetryReading[] |
| OrbitAchieved | ...Ascending + orbitAchievedAt: Date, finalAltitude: number |
| AbortSequence | name, destination, crewMembers, abortedAt: Date, reason: string, lastKnownAltitude: number |
| Cancelled | name, destination, crewMembers, cancelledAt: Date, reason: string |

`TelemetryReading`: `{ timestamp: string, altitude: number, velocity: number, heading: number }`

#### Commands

| Command | From State | Payload | Server Dep |
|---------|-----------|---------|------------|
| InitiateCountdown | Planning | {} | `telemetry.validateLaunchWindow()` |
| ScrubLaunch | Countdown | { reason: string } | — |
| RetryCountdown | Scrubbed | {} | `telemetry.validateLaunchWindow()` |
| Launch | Countdown | {} | — |
| UpdateTelemetry | Ascending | { altitude, velocity, heading } | Server-only (tracking loop) |
| AchieveOrbit | Ascending | {} | Server-only (tracking loop) |
| TriggerAbort | Ascending | { reason: string } | Server-only (tracking loop) |
| CancelMission | Planning | { reason: string } | — |

#### Events

CountdownStarted, LaunchScrubbed, Launched, TelemetryUpdated, OrbitAchieved, MissionAborted, MissionCancelled

#### Errors

LaunchWindowClosed (fuel < 80% or empty crew), MissionAlreadyComplete

---

## Server Architecture

### Stack

- **Runtime:** Bun
- **Persistence:** Redis (hashes for workflow state, SETs for state index)
- **Broadcasting:** Redis pub/sub → SSE fan-out
- **Framework:** Bun's built-in HTTP server (no framework dependency)

### Structure

```
server/
├── index.ts                # Bun HTTP server + SSE endpoints
├── redis-store.ts          # StoreAdapter backed by Redis
├── redis-broadcast.ts      # Redis pub/sub → SSE fan-out
├── router.ts               # WorkflowRouter with handlers + deps
├── telemetry.ts            # Fake TelemetryService (server-only dep)
└── tracking-loop.ts        # Background poller for Ascending missions
```

### Redis Store (`redis-store.ts`)

Implements `StoreAdapter` with Redis-specific extension:

```ts
interface RedisStoreAdapter extends StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
	findByState(state: string): Promise<Array<{ id: string }>>;
	list(): Promise<Array<{ id: string; snapshot: WorkflowSnapshot }>>;
}
```

**Storage layout:**
- `mission:{id}` — Redis hash with `snapshot` (JSON) and `version` (number)
- `missions:state:{stateName}` — Redis SET of mission IDs in that state (secondary index)
- `missions:all` — Redis SET of all mission IDs

**Optimistic concurrency:** `save()` uses a Lua script for atomic check-and-update:
```lua
local current = redis.call('HGET', KEYS[1], 'version')
if tonumber(current) ~= tonumber(ARGV[1]) then
  return redis.error_reply('CONFLICT:' .. current)
end
redis.call('HSET', KEYS[1], 'snapshot', ARGV[2], 'version', ARGV[1] + 1)
-- Update state index
redis.call('SREM', KEYS[2], KEYS[4])  -- remove from old state set
redis.call('SADD', KEYS[3], KEYS[4])  -- add to new state set
return 'OK'
```

### Redis Broadcast (`redis-broadcast.ts`)

- On successful `save()`, publishes `BroadcastMessage` to Redis channel `mission:{id}`
- Also publishes to `missions:list` channel for list-level updates
- SSE manager subscribes to Redis channels, maintains a `Map<string, Set<SSEClient>>` for fan-out

### HTTP Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| PUT | `/missions/:id` | Create mission (save initial snapshot) |
| POST | `/missions/:id` | Execute command via `executor.execute()` |
| GET | `/missions/:id` | Load current snapshot from Redis |
| GET | `/missions` | List all missions |
| GET | `/missions/:id/events` | SSE stream for a specific mission |
| GET | `/missions/events` | SSE stream for all missions (list updates) |

**Request flow:**
1. `POST /missions/:id` with `{ type: "Launch", payload: {} }`
2. Look up executor (one per workflow type, stateless)
3. `executor.execute(id, command)` — loads from Redis, dispatches, saves to Redis
4. On save success: publish to Redis pub/sub
5. Redis pub/sub → SSE fan-out to connected clients
6. Return `ExecutionResult` as JSON

### Stateless Server Design

```ts
// One executor, shared across all requests
const store = redisStore(redis);
const router = new WorkflowRouter(missionDef, { telemetry });
// ... register state handlers ...
const executor = new WorkflowExecutor(router, store);

// Request handler — completely stateless
server.post("/missions/:id", async (req) => {
	const result = await executor.execute(req.params.id, req.body);
	return Response.json(result);
});
```

No in-memory caching, no actor model. Redis is the single source of truth. Concurrency handled by optimistic locking in the Lua script.

### Telemetry Service (`telemetry.ts`)

Server-only dependency. Injected via router constructor: `new WorkflowRouter(missionDef, { telemetry })`.

```ts
interface TelemetryService {
	// Called during InitiateCountdown and RetryCountdown
	// Returns go/no-go based on fuel level and crew
	validateLaunchWindow(fuelLevel: number, crewSize: number): Promise<LaunchWindowResult>;

	// Called by tracking loop to analyze current readings
	// ~10% chance of anomaly per call
	analyzeReadings(readings: TelemetryReading[]): Promise<AnomalyResult>;

	// Called by tracking loop to get simulated flight data
	// Altitude increases ~50km/tick, deterministic per mission
	getFlightData(missionId: string): Promise<FlightData>;
}
```

**Fake implementation details:**
- `validateLaunchWindow()`: No-go if fuel < 80% or crew empty. 300ms fake delay.
- `analyzeReadings()`: ~10% anomaly chance (seeded random). 200ms fake delay.
- `getFlightData()`: Simple physics sim — altitude increases ~50km per call, velocity increases proportionally, heading stays stable. Deterministic per mission ID so restarts produce consistent results. 200ms fake delay.

### Tracking Loop (`tracking-loop.ts`)

Background process, completely independent of request handling:

```ts
async function trackingLoop(store: RedisStoreAdapter, executor: WorkflowExecutor, telemetry: TelemetryService) {
	const ascending = await store.findByState("Ascending");

	for (const { id } of ascending) {
		const readings = await telemetry.getFlightData(id);
		const analysis = await telemetry.analyzeReadings([readings]);

		if (analysis.anomaly) {
			await executor.execute(id, {
				type: "TriggerAbort",
				payload: { reason: analysis.reason },
			});
		} else if (readings.altitude >= 400) {
			await executor.execute(id, {
				type: "AchieveOrbit",
				payload: {},
			});
		} else {
			await executor.execute(id, {
				type: "UpdateTelemetry",
				payload: { altitude: readings.altitude, velocity: readings.velocity, heading: readings.heading },
			});
		}
	}
}

setInterval(() => trackingLoop(store, executor, telemetry), 2000);
```

---

## Client Architecture

### Stack

- **Framework:** React 19 + TypeScript
- **Build:** Vite
- **Components:** shadcn/ui (themed dark/space)
- **State:** `createWorkflowClient` + `useWorkflow`
- **Visualization:** Pure SVG (no WebGL)

### Structure

```
client/
├── index.html
├── main.tsx                    # React entry
├── App.tsx                     # Layout: sidebar + detail
├── transport.ts                # Transport impl (fetch + EventSource)
├── lib/
│   └── utils.ts                # shadcn/ui utils (cn helper)
├── components/
│   ├── MissionList.tsx         # Sidebar: all missions with state badges
│   ├── MissionDetail.tsx       # State-dependent detail view
│   ├── CreateMission.tsx       # Form to create new missions
│   ├── PlanningView.tsx        # Pre-launch config
│   ├── CountdownView.tsx       # GO/NO-GO display, launch/scrub buttons
│   ├── AscendingView.tsx       # Live telemetry dashboard (hero view)
│   ├── TerminalViews.tsx       # OrbitAchieved, AbortSequence, Scrubbed, Cancelled
│   └── viz/
│       ├── TrajectoryViz.tsx   # SVG trajectory/orbit visualization
│       ├── TelemetryGauge.tsx  # SVG circular gauge component
│       └── AltitudeChart.tsx   # Sparkline altitude-over-time chart
└── styles/
    └── globals.css             # Dark theme, space fonts
```

### Transport Implementation (`client/transport.ts`)

Implements the `Transport` interface from `@rytejs/react`:

```ts
function createMissionTransport(baseUrl: string): Transport {
	return {
		async dispatch(id, command, expectedVersion) {
			const res = await fetch(`${baseUrl}/missions/${id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...command, expectedVersion }),
			});
			return res.json();
		},
		subscribe(id, callback) {
			const source = new EventSource(`${baseUrl}/missions/${id}/events`);
			source.onmessage = (e) => callback(JSON.parse(e.data));
			return { unsubscribe: () => source.close() };
		},
	};
}
```

### Client Usage

```tsx
import { createWorkflowClient } from "@rytejs/react";
import { missionDef } from "../shared/mission.js";
import { createMissionTransport } from "./transport.js";

const transport = createMissionTransport("http://localhost:4000");
const client = createWorkflowClient(transport);

function MissionDetail({ id }: { id: string }) {
	const mission = client.connect(missionDef, id);
	const wf = useWorkflow(mission);

	return wf.match({
		Planning: (data) => <PlanningView data={data} dispatch={wf.dispatch} />,
		Countdown: (data) => <CountdownView data={data} dispatch={wf.dispatch} />,
		Ascending: (data) => <AscendingView data={data} />,
		OrbitAchieved: (data) => <OrbitAchievedView data={data} />,
		// ...
	});
}
```

### UI Design

**Design language:** SpaceX Crew Dragon meets NASA OpenMCT. Minimal dark interface with data-dense telemetry panels.

**Color palette:**
- Background: `#0a0e17` (near-black blue)
- Surface: `#111827` (dark gray-blue)
- Border: `#1e293b` (subtle)
- Primary accent: `#00d4ff` (cyan — nominal/active data)
- Warning: `#f59e0b` (amber — caution states)
- Critical: `#ef4444` (red — abort/error)
- Success: `#22c55e` (green — GO/nominal)
- Text primary: `#e2e8f0` (light gray)
- Text muted: `#64748b` (medium gray)

**Typography:**
- UI text: Inter (via shadcn/ui default)
- Telemetry readings: JetBrains Mono (monospace, for altitude/velocity/heading)

**shadcn/ui components used:** Card, Badge, Button, Progress, Input, Label, Separator, ScrollArea

**Key views:**

1. **Mission List (sidebar)**
   - Dark card per mission showing name + destination
   - State badge color-coded (cyan = active, green = success, red = abort, amber = scrubbed)
   - "New Mission" button at top
   - Live-updating via all-missions SSE stream

2. **Ascending View (hero)**
   - Top: mission name + "ASCENDING" badge with pulse animation
   - Center: SVG trajectory visualization
     - Earth curvature arc at bottom with atmosphere gradient
     - Dashed orbit line at 400km
     - Rocket icon positioned along trajectory curve, moves upward on each update
     - Altitude markers on vertical axis (0km, 100km, 200km, 300km, 400km)
     - CSS transition for smooth position animation between telemetry ticks
   - Below visualization: three telemetry gauges (altitude, velocity, heading)
     - SVG circular arc gauges with digital readout center
     - Cyan fill for nominal, amber for approaching limits
   - Bottom: altitude-over-time sparkline chart
     - Updates with each `TelemetryUpdated` event
     - Shows trajectory history as a line chart

3. **Countdown View**
   - Large "T-minus" style display
   - GO/NO-GO indicator — large green "GO" or red "NO-GO" badge
   - "LAUNCH" button (primary, cyan glow) and "SCRUB" button (outline, amber)

4. **Terminal Views**
   - OrbitAchieved: celebration layout, final stats in data grid, orbit visualization showing stable circular path
   - AbortSequence: red alert border, last known telemetry, abort reason
   - Scrubbed: amber accent, reason, attempt count, "Retry Countdown" button
   - Cancelled: muted layout with reason

---

## Fake Network Delays

To simulate real network conditions:

- **Server-side telemetry service:** 200-500ms delays on all methods (already described)
- **Transport dispatch:** Add 100-300ms random delay in the fetch transport before returning response
- **SSE delivery:** Server adds 50-100ms delay before publishing to SSE after Redis pub/sub receives message

These make the UI feel realistic — `isDispatching` state is visible, loading spinners have time to show, and telemetry updates arrive with natural cadence.

---

## Testing

### Playwright Verification

Use the `playwright-cli` skill to verify:

1. **Mission creation** — Fill form, create mission, verify it appears in list
2. **Countdown flow** — Initiate countdown, verify GO/NO-GO display, launch
3. **Ascending visualization** — Verify SVG trajectory updates, telemetry gauges animate
4. **Terminal states** — Verify orbit achieved and abort views render correctly
5. **Visual regression** — Screenshot each state for design verification
6. **Concurrency** — Open two browser tabs, dispatch from both, verify one gets conflict handling

### Unit Tests

- Redis store adapter: load/save/findByState with mock Redis
- Telemetry service: deterministic output verification
- Tracking loop: correct command dispatched based on telemetry readings
- Mission workflow: all state transitions via router dispatch

---

## Project Setup

```
examples/mission-control/
├── package.json            # bun + vite + react + @rytejs/* deps
├── tsconfig.json           # paths for shared/ imports
├── vite.config.ts          # proxy /api to Bun server in dev
├── docker-compose.yml      # Redis only
├── shared/
├── server/
└── client/
```

**Dev workflow:**
```bash
docker compose up -d          # Start Redis
bun run server/index.ts       # Start Bun server on :4000
pnpm vite                     # Start Vite dev server on :5173 (proxies /api → :4000)
```

**Dependencies:**
- `@rytejs/core`, `@rytejs/react` — workspace link or npm
- `react`, `react-dom` — 19
- `zod` — peer dep
- Bun has native Redis support via `Bun.redis` (no additional package needed)
- `vite`, `@vitejs/plugin-react` — client build
- shadcn/ui components (installed via CLI)
