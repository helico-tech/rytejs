# Mission Control Full-Stack Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack Space Mission Control example demonstrating @rytejs with Bun + Redis server, React frontend with NASA/SpaceX-inspired UI, real-time SSE sync, server-only dependencies, and autonomous tracking.

**Architecture:** Standalone `examples/mission-control/` project. Server: Bun HTTP + Redis (hashes for state, SETs for indexes, pub/sub for broadcast). Client: Vite + React 19 + shadcn/ui, connects via `createWorkflowClient(transport)`. Shared workflow definition (Zod schemas) imported by both. Background tracking loop polls Redis for ascending missions and pushes telemetry updates.

**Tech Stack:** Bun, Redis, React 19, Vite, TypeScript, shadcn/ui, Zod 4, @rytejs/core, @rytejs/react

**Spec:** `docs/superpowers/specs/2026-03-21-mission-control-example-design.md`

---

## File Structure

```
examples/mission-control/
├── package.json                    # Bun + Vite + React + @rytejs deps
├── tsconfig.json                   # Shared TS config
├── tsconfig.server.json            # Server-specific TS config
├── vite.config.ts                  # Vite dev server + proxy
├── docker-compose.yml              # Redis container
├── README.md                       # Setup and usage instructions
│
├── shared/
│   └── mission.ts                  # WorkflowDefinition — Zod schemas, no server code
│
├── server/
│   ├── index.ts                    # Bun HTTP server entry + tracking loop bootstrap
│   ├── redis-store.ts              # RedisStoreAdapter (StoreAdapter + findByState + list + create)
│   ├── broadcast.ts                # Redis pub/sub → SSE fan-out manager
│   ├── router.ts                   # WorkflowRouter with state handlers + deps
│   ├── telemetry.ts                # Fake TelemetryService (server-only dep)
│   ├── tracking-loop.ts            # Background poller for Ascending missions
│   └── __tests__/
│       ├── redis-store.test.ts     # Store adapter tests (uses real Redis)
│       ├── telemetry.test.ts       # Telemetry service tests
│       ├── router.test.ts          # Workflow state transition tests
│       └── tracking-loop.test.ts   # Tracking loop logic tests
│
├── client/
│   ├── index.html                  # Vite HTML entry
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Layout: sidebar + detail panel
│   ├── transport.ts                # Transport impl (fetch + EventSource)
│   ├── globals.css                 # Dark theme, fonts, shadcn vars
│   ├── lib/
│   │   └── utils.ts                # cn() helper for shadcn
│   ├── components/
│   │   ├── MissionList.tsx         # Sidebar: all missions with state badges
│   │   ├── MissionDetail.tsx       # State-dispatching detail view
│   │   ├── CreateMission.tsx       # New mission form dialog
│   │   ├── PlanningView.tsx        # Pre-launch config
│   │   ├── CountdownView.tsx       # GO/NO-GO + launch/scrub buttons
│   │   ├── AscendingView.tsx       # Live telemetry dashboard (hero)
│   │   ├── ScrubbedView.tsx        # Amber view + retry button
│   │   └── TerminalViews.tsx       # OrbitAchieved, AbortSequence, Cancelled
│   └── components/viz/
│       ├── TrajectoryViz.tsx       # SVG Earth + trajectory + rocket
│       ├── TelemetryGauge.tsx      # SVG circular arc gauge
│       └── AltitudeChart.tsx       # SVG sparkline chart
│
└── components.json                 # shadcn/ui config
```

---

### Task 1: Project scaffolding

Set up the project skeleton with configs, dependencies, and Docker.

**Files:**
- Create: `examples/mission-control/package.json`
- Create: `examples/mission-control/tsconfig.json`
- Create: `examples/mission-control/tsconfig.server.json`
- Create: `examples/mission-control/vite.config.ts`
- Create: `examples/mission-control/docker-compose.yml`
- Create: `examples/mission-control/README.md`
- Create: `examples/mission-control/client/index.html`
- Create: `examples/mission-control/client/lib/utils.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
	"name": "@rytejs/example-mission-control",
	"private": true,
	"type": "module",
	"scripts": {
		"dev:server": "bun run --watch server/index.ts",
		"dev:client": "vite",
		"dev": "bun run dev:server & vite",
		"build": "vite build",
		"test": "bun test",
		"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json"
	},
	"dependencies": {
		"@rytejs/core": "workspace:*",
		"@rytejs/react": "workspace:*",
		"react": "^19.0.0",
		"react-dom": "^19.0.0",
		"zod": "^4.0.0",
		"clsx": "^2.0.0",
		"tailwind-merge": "^2.0.0"
	},
	"devDependencies": {
		"@tailwindcss/vite": "^4.0.0",
		"@types/react": "^19.0.0",
		"@types/react-dom": "^19.0.0",
		"@vitejs/plugin-react": "^4.0.0",
		"tailwindcss": "^4.0.0",
		"typescript": "^5.7.0",
		"vite": "^6.0.0"
	},
	"engines": {
		"bun": ">=1.2.0"
	}
}
```

- [ ] **Step 2: Create `tsconfig.json`** (client)

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"jsx": "react-jsx",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"outDir": "./dist",
		"rootDir": ".",
		"lib": ["ES2022", "DOM", "DOM.Iterable"],
		"paths": {
			"@shared/*": ["./shared/*"]
		}
	},
	"include": ["client", "shared"],
	"exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `tsconfig.server.json`**

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"outDir": "./dist-server",
		"rootDir": ".",
		"lib": ["ES2022"],
		"types": ["bun-types"]
	},
	"include": ["server", "shared"],
	"exclude": ["node_modules", "dist", "client"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: "client",
	plugins: [tailwindcss(), react()],
	resolve: {
		alias: {
			"@shared": "../shared",
		},
	},
	server: {
		proxy: {
			"/missions": {
				target: "http://localhost:4000",
				changeOrigin: true,
			},
		},
	},
});
```

- [ ] **Step 5: Create `docker-compose.yml`**

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --save "" --appendonly no
```

- [ ] **Step 6: Create `client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Mission Control — @rytejs</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
</head>
<body>
	<div id="root"></div>
	<script type="module" src="/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Create `client/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
```

Note: `clsx`, `tailwind-merge`, `tailwindcss`, and `@tailwindcss/vite` are already included in `package.json` above.

- [ ] **Step 8: Create `README.md`**

Write a README with: overview, prerequisites (Docker, Bun, pnpm), quick start (docker compose up, bun install, dev commands), the example lifecycle (create mission, countdown, launch, track, orbit), and architecture overview.

- [ ] **Step 9: Install dependencies**

```bash
cd examples/mission-control && bun install
```

- [ ] **Step 10: Initialize shadcn/ui**

Initialize shadcn/ui for the project. Install needed components: Button, Card, Badge, Input, Label, Dialog, Separator, ScrollArea, Slider, Progress. Follow the shadcn docs for Vite + Tailwind v4 setup. If shadcn/ui is incompatible with Tailwind v4, use hand-crafted components styled with Tailwind classes matching the design spec colors.

- [ ] **Step 11: Commit**

```bash
git add examples/mission-control/ && git commit -m "chore: scaffold mission-control example project"
```

---

### Task 2: Shared workflow definition

The type contract shared between server and client.

**Files:**
- Create: `examples/mission-control/shared/mission.ts`

- [ ] **Step 1: Write the workflow definition**

```ts
import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

const TelemetryReadingSchema = z.object({
	timestamp: z.string(),
	altitude: z.number(),
	velocity: z.number(),
	heading: z.number(),
});

export type TelemetryReading = z.infer<typeof TelemetryReadingSchema>;

export const missionDef = defineWorkflow("mission", {
	states: {
		Planning: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
		}),
		Countdown: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			countdownStartedAt: z.coerce.date(),
			telemetryStatus: z.enum(["go", "no-go"]),
		}),
		Scrubbed: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			scrubbedAt: z.coerce.date(),
			reason: z.string(),
			attemptNumber: z.number(),
		}),
		Ascending: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			countdownStartedAt: z.coerce.date(),
			telemetryStatus: z.enum(["go", "no-go"]),
			launchedAt: z.coerce.date(),
			altitude: z.number(),
			velocity: z.number(),
			heading: z.number(),
			telemetryReadings: z.array(TelemetryReadingSchema),
		}),
		OrbitAchieved: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			launchedAt: z.coerce.date(),
			altitude: z.number(),
			velocity: z.number(),
			heading: z.number(),
			telemetryReadings: z.array(TelemetryReadingSchema),
			orbitAchievedAt: z.coerce.date(),
			finalAltitude: z.number(),
		}),
		AbortSequence: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			abortedAt: z.coerce.date(),
			reason: z.string(),
			lastKnownAltitude: z.number(),
		}),
		Cancelled: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			cancelledAt: z.coerce.date(),
			reason: z.string(),
		}),
	},
	commands: {
		InitiateCountdown: z.object({}),
		ScrubLaunch: z.object({ reason: z.string() }),
		RetryCountdown: z.object({}),
		Launch: z.object({}),
		UpdateTelemetry: z.object({
			altitude: z.number(),
			velocity: z.number(),
			heading: z.number(),
		}),
		AchieveOrbit: z.object({}),
		TriggerAbort: z.object({ reason: z.string() }),
		CancelMission: z.object({ reason: z.string() }),
	},
	events: {
		CountdownStarted: z.object({ missionId: z.string() }),
		LaunchScrubbed: z.object({ missionId: z.string(), reason: z.string() }),
		Launched: z.object({ missionId: z.string() }),
		TelemetryUpdated: z.object({ missionId: z.string(), altitude: z.number() }),
		OrbitAchieved: z.object({ missionId: z.string(), altitude: z.number() }),
		MissionAborted: z.object({ missionId: z.string(), reason: z.string() }),
		MissionCancelled: z.object({ missionId: z.string(), reason: z.string() }),
	},
	errors: {
		LaunchWindowClosed: z.object({}),
	},
});

export type MissionConfig = typeof missionDef.config;
```

- [ ] **Step 2: Commit**

```bash
git add examples/mission-control/shared/ && git commit -m "feat: add mission workflow definition"
```

---

### Task 3: Telemetry service (server-only dep)

Fake service with deterministic behavior and simulated delays.

**Files:**
- Create: `examples/mission-control/server/telemetry.ts`
- Create: `examples/mission-control/server/__tests__/telemetry.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, test } from "bun:test";
import { createTelemetryService } from "../telemetry.ts";

describe("TelemetryService", () => {
	const telemetry = createTelemetryService();

	describe("validateLaunchWindow", () => {
		test("returns go when fuel >= 80 and crew non-empty", async () => {
			const result = await telemetry.validateLaunchWindow(85, 3);
			expect(result.go).toBe(true);
		});

		test("returns no-go when fuel < 80", async () => {
			const result = await telemetry.validateLaunchWindow(50, 3);
			expect(result.go).toBe(false);
		});

		test("returns no-go when crew is empty", async () => {
			const result = await telemetry.validateLaunchWindow(95, 0);
			expect(result.go).toBe(false);
		});
	});

	describe("getFlightData", () => {
		test("returns increasing altitude over successive calls", async () => {
			const r1 = await telemetry.getFlightData("test-mission-1");
			const r2 = await telemetry.getFlightData("test-mission-1");
			expect(r2.altitude).toBeGreaterThan(r1.altitude);
		});

		test("heading stays near 90 degrees", async () => {
			const result = await telemetry.getFlightData("test-heading");
			expect(result.heading).toBeGreaterThan(85);
			expect(result.heading).toBeLessThan(95);
		});

		test("different missions have independent altitude tracking", async () => {
			const a1 = await telemetry.getFlightData("mission-a");
			const b1 = await telemetry.getFlightData("mission-b");
			// Both should be first-call altitude (low)
			expect(a1.altitude).toBeLessThan(100);
			expect(b1.altitude).toBeLessThan(100);
		});
	});

	describe("analyzeReadings", () => {
		test("returns anomaly status", async () => {
			const result = await telemetry.analyzeReadings([
				{ timestamp: new Date().toISOString(), altitude: 100, velocity: 2, heading: 90 },
			]);
			expect(typeof result.anomaly).toBe("boolean");
			if (result.anomaly) {
				expect(typeof result.reason).toBe("string");
			}
		});
	});
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
cd examples/mission-control && bun test server/__tests__/telemetry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement telemetry service**

Create `examples/mission-control/server/telemetry.ts`:

```ts
export interface LaunchWindowResult {
	go: boolean;
	reason?: string;
}

export interface FlightData {
	altitude: number;
	velocity: number;
	heading: number;
	timestamp: string;
}

export interface AnomalyResult {
	anomaly: boolean;
	reason?: string;
}

export interface TelemetryService {
	validateLaunchWindow(fuelLevel: number, crewSize: number): Promise<LaunchWindowResult>;
	getFlightData(missionId: string): Promise<FlightData>;
	analyzeReadings(readings: Array<{ timestamp: string; altitude: number; velocity: number; heading: number }>): Promise<AnomalyResult>;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTelemetryService(): TelemetryService {
	// Track altitude progression per mission (deterministic)
	const flightCounters = new Map<string, number>();

	return {
		async validateLaunchWindow(fuelLevel, crewSize) {
			await sleep(200 + Math.random() * 100); // 200-300ms fake delay

			if (crewSize === 0) {
				return { go: false, reason: "No crew assigned" };
			}
			if (fuelLevel < 80) {
				return { go: false, reason: `Fuel level ${fuelLevel}% below 80% threshold` };
			}
			return { go: true };
		},

		async getFlightData(missionId) {
			await sleep(100 + Math.random() * 100); // 100-200ms fake delay

			const tick = (flightCounters.get(missionId) ?? 0) + 1;
			flightCounters.set(missionId, tick);

			// Simple physics: altitude increases ~50km per tick with slight acceleration
			const altitude = Math.round(tick * 50 + tick * tick * 2);
			const velocity = Math.round((2 + tick * 0.8) * 10) / 10;
			const heading = 90 + (Math.sin(tick * 0.3) * 2); // slight wobble around 90°

			return {
				altitude: Math.min(altitude, 500),
				velocity: Math.min(velocity, 8),
				heading: Math.round(heading * 10) / 10,
				timestamp: new Date().toISOString(),
			};
		},

		async analyzeReadings(readings) {
			await sleep(100 + Math.random() * 100); // 100-200ms fake delay

			// ~10% anomaly chance — seeded from reading data for some determinism
			const seed = readings.length > 0 ? readings[readings.length - 1].altitude : 0;
			const anomaly = (seed * 7 + Date.now()) % 100 < 10;

			return {
				anomaly,
				reason: anomaly ? "Trajectory deviation detected — flight path outside nominal corridor" : undefined,
			};
		},
	};
}
```

- [ ] **Step 4: Run tests**

```bash
cd examples/mission-control && bun test server/__tests__/telemetry.test.ts
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add examples/mission-control/server/telemetry.ts examples/mission-control/server/__tests__/ && git commit -m "feat: add fake telemetry service"
```

---

### Task 4: Mission workflow router (server-only handlers)

Register state handlers with server-only deps.

**Files:**
- Create: `examples/mission-control/server/router.ts`
- Create: `examples/mission-control/server/__tests__/router.test.ts`

- [ ] **Step 1: Write tests**

Test all state transitions: Planning→Countdown, Countdown→Ascending (Launch), Countdown→Scrubbed, Scrubbed→Countdown (Retry), Ascending→OrbitAchieved, Ascending→AbortSequence, Planning→Cancelled. Test the LaunchWindowClosed error for fuel < 80%. Use `@rytejs/core`'s `router.dispatch()` directly with a mock telemetry dep.

- [ ] **Step 2: Run tests — verify failure**

- [ ] **Step 3: Implement router**

Create `examples/mission-control/server/router.ts` with `createMissionRouter(deps)` that returns a `WorkflowRouter`. Register handlers for all states:

- **Planning**: `InitiateCountdown` (calls `deps.telemetry.validateLaunchWindow()`, errors with LaunchWindowClosed on no-go, transitions to Countdown), `CancelMission` (transitions to Cancelled)
- **Countdown**: `Launch` (transitions to Ascending with initial telemetry), `ScrubLaunch` (transitions to Scrubbed with attempt count)
- **Scrubbed**: `RetryCountdown` (calls `deps.telemetry.validateLaunchWindow()`, transitions back to Countdown)
- **Ascending**: `UpdateTelemetry` (appends reading, updates altitude/velocity/heading), `AchieveOrbit` (transitions to OrbitAchieved), `TriggerAbort` (transitions to AbortSequence)

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add examples/mission-control/server/router.ts examples/mission-control/server/__tests__/router.test.ts && git commit -m "feat: add mission workflow router with state handlers"
```

---

### Task 5: Redis store adapter

Implements `StoreAdapter` with `findByState()`, `list()`, `create()`.

**Files:**
- Create: `examples/mission-control/server/redis-store.ts`
- Create: `examples/mission-control/server/__tests__/redis-store.test.ts`

- [ ] **Step 1: Write tests**

Test: `create()` saves and sets version to 1, `load()` returns stored data, `load()` returns null for unknown ID, `save()` increments version, `save()` throws on version conflict, `findByState()` returns correct IDs, `list()` returns all missions, state index updates on save (old state removed, new state added). These tests require a real Redis instance — skip if not available.

- [ ] **Step 2: Run tests — verify failure**

- [ ] **Step 3: Implement Redis store**

Create `examples/mission-control/server/redis-store.ts`:

```ts
import { ConcurrencyConflictError } from "@rytejs/core/store";
import type { SaveOptions, StoreAdapter, StoredWorkflow } from "@rytejs/core/store";
import type { WorkflowSnapshot } from "@rytejs/core";

export interface RedisStoreAdapter extends StoreAdapter {
	create(id: string, snapshot: WorkflowSnapshot): Promise<void>;
	findByState(state: string): Promise<Array<{ id: string }>>;
	list(): Promise<Array<{ id: string; snapshot: WorkflowSnapshot }>>;
}
```

Key implementation points:
- Use `Bun.RedisClient` for Redis connection
- `create()`: `HSET mission:{id} snapshot <json> version 1`, `SADD missions:all {id}`, `SADD missions:state:{state} {id}`
- `load()`: `HMGET mission:{id} snapshot version`, return null if not found
- `save()`: Lua script for atomic version check + update + state index maintenance. Extract old state from current snapshot before saving. Throw `ConcurrencyConflictError` on version mismatch.
- `findByState()`: `SMEMBERS missions:state:{state}`
- `list()`: `SMEMBERS missions:all` then load each

- [ ] **Step 4: Run tests**

```bash
cd examples/mission-control && bun test server/__tests__/redis-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add examples/mission-control/server/redis-store.ts examples/mission-control/server/__tests__/redis-store.test.ts && git commit -m "feat: add Redis store adapter with optimistic concurrency"
```

---

### Task 6: Redis broadcast + SSE manager

Handles Redis pub/sub → SSE fan-out to connected clients.

**Files:**
- Create: `examples/mission-control/server/broadcast.ts`

- [ ] **Step 1: Implement broadcast manager**

Create `examples/mission-control/server/broadcast.ts`:

```ts
import type { RedisClient } from "bun";
import type { WorkflowSnapshot } from "@rytejs/core";

export interface BroadcastManager {
	// Called after successful save — publishes to Redis
	publish(id: string, snapshot: WorkflowSnapshot, version: number, events: Array<{ type: string; data: unknown }>): Promise<void>;

	// SSE: add a client listening for a specific mission
	addClient(missionId: string, writer: WritableStreamDefaultWriter<Uint8Array>): () => void;

	// SSE: add a client listening for all mission list updates
	addListClient(writer: WritableStreamDefaultWriter<Uint8Array>): () => void;

	// Start listening to Redis pub/sub
	start(): Promise<void>;
}
```

Key implementation:
- `publish()`: Publishes JSON to Redis channel `mission:{id}` and `missions:list`
- `start()`: Subscribes to `mission:*` pattern via Redis pub/sub. On message, fans out to SSE clients via their `WritableStreamDefaultWriter`.
- `addClient()`: Adds writer to `Map<string, Set<Writer>>`, returns cleanup function.
- `addListClient()`: Adds writer to a separate set for list-level updates.
- SSE message format: `data: ${JSON.stringify(broadcastMessage)}\n\n`
- 50-100ms fake delay before fan-out to simulate network latency.

- [ ] **Step 2: Commit**

```bash
git add examples/mission-control/server/broadcast.ts && git commit -m "feat: add Redis broadcast + SSE fan-out manager"
```

---

### Task 7: Tracking loop

Background poller for Ascending missions.

**Files:**
- Create: `examples/mission-control/server/tracking-loop.ts`
- Create: `examples/mission-control/server/__tests__/tracking-loop.test.ts`

- [ ] **Step 1: Write tests**

Test with mocked store, executor, and telemetry: sends `UpdateTelemetry` when altitude < 400, sends `AchieveOrbit` when altitude >= 400, sends `TriggerAbort` on anomaly, skips mission on error (doesn't crash loop).

- [ ] **Step 2: Implement tracking loop**

```ts
import type { WorkflowExecutor } from "@rytejs/core/executor";
import type { RedisStoreAdapter } from "./redis-store.ts";
import type { TelemetryService } from "./telemetry.ts";

export function startTrackingLoop(
	store: RedisStoreAdapter,
	executor: WorkflowExecutor<any>,
	telemetry: TelemetryService,
	intervalMs = 2000,
): { stop: () => void } {
	const timer = setInterval(async () => {
		try {
			const ascending = await store.findByState("Ascending");
			for (const { id } of ascending) {
				try {
					const readings = await telemetry.getFlightData(id);
					const analysis = await telemetry.analyzeReadings([readings]);

					if (analysis.anomaly) {
						await executor.execute(id, { type: "TriggerAbort", payload: { reason: analysis.reason! } });
					} else if (readings.altitude >= 400) {
						await executor.execute(id, { type: "AchieveOrbit", payload: {} });
					} else {
						await executor.execute(id, {
							type: "UpdateTelemetry",
							payload: { altitude: readings.altitude, velocity: readings.velocity, heading: readings.heading },
						});
					}
				} catch (err) {
					console.error(`Tracking error for mission ${id}:`, err);
				}
			}
		} catch (err) {
			console.error("Tracking loop error:", err);
		}
	}, intervalMs);

	return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add examples/mission-control/server/tracking-loop.ts examples/mission-control/server/__tests__/ && git commit -m "feat: add tracking loop for ascending missions"
```

---

### Task 8: Bun HTTP server

The main server entry point — wires everything together.

**Files:**
- Create: `examples/mission-control/server/index.ts`

- [ ] **Step 1: Implement server**

Wire up: Redis connection, `createRedisStore()`, `createMissionRouter()`, `WorkflowExecutor`, `BroadcastManager`, `startTrackingLoop()`. Register HTTP routes:

- `PUT /missions/:id` — Create mission. Parse body `{ name, destination, crewMembers, fuelLevel }`. Call `missionDef.createWorkflow(id, { initialState: "Planning", data })`. Save via `store.create()`. Broadcast. Return snapshot.
- `POST /missions/:id` — Execute command. Parse body `{ type, payload }`. Call `executor.execute(id, body)`. On success, broadcast. Return result.
- `GET /missions/:id` — Load from store. Return snapshot or 404.
- `GET /missions` — List all. Return array of `{ id, snapshot }`.
- `GET /missions/:id/events` — SSE endpoint. Return `new Response(stream)` with `text/event-stream` headers. Register with broadcast manager.
- `GET /missions/events` — SSE for list updates.

Use `Bun.serve()` with `fetch(req)` handler. Parse routes manually (no framework). Add CORS headers for Vite dev server.

Integrate broadcast: after `executor.execute()` returns success, call `broadcastManager.publish()`. Also call after `store.create()`.

- [ ] **Step 2: Manual smoke test**

```bash
docker compose up -d
bun run server/index.ts &
curl -X PUT http://localhost:4000/missions/test-1 -H "Content-Type: application/json" -d '{"name":"Apollo","destination":"LEO","crewMembers":["Alice"],"fuelLevel":95}'
curl http://localhost:4000/missions/test-1
curl -X POST http://localhost:4000/missions/test-1 -H "Content-Type: application/json" -d '{"type":"InitiateCountdown","payload":{}}'
```

- [ ] **Step 3: Commit**

```bash
git add examples/mission-control/server/index.ts && git commit -m "feat: add Bun HTTP server with SSE endpoints"
```

---

### Task 9: Client transport + app shell

The React app skeleton with Transport implementation.

**Files:**
- Create: `examples/mission-control/client/transport.ts`
- Create: `examples/mission-control/client/globals.css`
- Create: `examples/mission-control/client/main.tsx`
- Create: `examples/mission-control/client/App.tsx`

- [ ] **Step 1: Create Transport implementation**

```ts
import type { Transport, BroadcastMessage, TransportResult } from "@rytejs/react";
import type { StoredWorkflow } from "@rytejs/core/store";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMissionTransport(baseUrl: string): Transport {
	return {
		async load(id: string): Promise<StoredWorkflow | null> {
			const res = await fetch(`${baseUrl}/missions/${id}`);
			if (!res.ok) return null;
			// Server returns { snapshot, version } (a StoredWorkflow)
			return res.json();
		},

		async dispatch(id, command, expectedVersion): Promise<TransportResult> {
			await sleep(100 + Math.random() * 200); // fake network delay
			const res = await fetch(`${baseUrl}/missions/${id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...command, expectedVersion }),
			});
			return res.json();
		},

		subscribe(id, callback) {
			const source = new EventSource(`${baseUrl}/missions/${id}/events`);
			source.onmessage = (e) => {
				const msg: BroadcastMessage = JSON.parse(e.data);
				callback(msg);
			};
			source.onerror = () => {
				console.warn(`SSE error for mission ${id}, auto-reconnecting...`);
			};
			return { unsubscribe: () => source.close() };
		},
	};
}
```

- [ ] **Step 2: Create `globals.css`**

Dark theme with space aesthetic. Define CSS custom properties for the color palette. Import Tailwind. Set body background, font family (Inter default, JetBrains Mono for `.font-mono`).

```css
@import "tailwindcss";

:root {
	--background: 222 47% 5%;
	--foreground: 210 40% 90%;
	--card: 217 33% 8%;
	--card-foreground: 210 40% 90%;
	--primary: 192 100% 50%;
	--primary-foreground: 222 47% 5%;
	--secondary: 217 33% 15%;
	--secondary-foreground: 210 40% 90%;
	--muted: 215 20% 30%;
	--muted-foreground: 215 20% 55%;
	--accent: 192 100% 50%;
	--accent-foreground: 222 47% 5%;
	--destructive: 0 84% 60%;
	--destructive-foreground: 210 40% 90%;
	--border: 217 25% 18%;
	--ring: 192 100% 50%;
	--radius: 0.5rem;

	--success: 142 71% 45%;
	--warning: 38 92% 50%;
	--cyan: 192 100% 50%;
}

body {
	margin: 0;
	background: hsl(var(--background));
	color: hsl(var(--foreground));
	font-family: "Inter", system-ui, sans-serif;
	-webkit-font-smoothing: antialiased;
}

.font-mono {
	font-family: "JetBrains Mono", monospace;
}
```

- [ ] **Step 3: Create `main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
```

- [ ] **Step 4: Create `App.tsx`** (shell)

Basic layout — sidebar (MissionList) + main panel (MissionDetail). Use the `createWorkflowClient` pattern:

```tsx
import { createWorkflowClient } from "@rytejs/react";
import { useState } from "react";
import { missionDef } from "../shared/mission.ts";
import { createMissionTransport } from "./transport.ts";

const transport = createMissionTransport("");
export const client = createWorkflowClient(transport);

export function App() {
	const [selectedId, setSelectedId] = useState<string | null>(null);

	return (
		<div className="flex h-screen">
			<aside className="w-80 border-r border-[hsl(var(--border))] overflow-y-auto">
				{/* MissionList will go here */}
				<div className="p-4 text-[hsl(var(--muted-foreground))]">Loading missions...</div>
			</aside>
			<main className="flex-1 overflow-y-auto">
				{selectedId ? (
					<div className="p-6">Mission: {selectedId}</div>
				) : (
					<div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))]">
						Select a mission or create a new one
					</div>
				)}
			</main>
		</div>
	);
}
```

- [ ] **Step 5: Verify dev server starts**

```bash
cd examples/mission-control && npx vite --open
```

Expected: Vite dev server starts, shows the shell layout.

- [ ] **Step 6: Commit**

```bash
git add examples/mission-control/client/ && git commit -m "feat: add client app shell with transport"
```

---

### Task 10: Mission list + create mission

Sidebar showing all missions with live SSE updates.

**Files:**
- Create: `examples/mission-control/client/components/MissionList.tsx`
- Create: `examples/mission-control/client/components/CreateMission.tsx`
- Modify: `examples/mission-control/client/App.tsx`

- [ ] **Step 1: Implement MissionList**

Fetches `GET /missions` on mount. Subscribes to `GET /missions/events` SSE for live updates. Renders each mission as a card with name, destination, and color-coded state badge. onClick selects mission.

State badge colors: Planning→cyan, Countdown→cyan, Ascending→cyan (pulsing), Scrubbed→amber, OrbitAchieved→green, AbortSequence→red, Cancelled→muted.

- [ ] **Step 2: Implement CreateMission**

Dialog/form with fields: name, destination, crew members (comma-separated input), fuel level (slider). Submits PUT to `/missions/:id` with generated UUID. On success, closes dialog and selects the new mission.

- [ ] **Step 3: Wire into App.tsx**

- [ ] **Step 4: Commit**

```bash
git add examples/mission-control/client/ && git commit -m "feat: add mission list and create mission UI"
```

---

### Task 11: State-specific views (Planning, Countdown, Scrubbed, Terminal)

The detail panel views for each mission state.

**Files:**
- Create: `examples/mission-control/client/components/MissionDetail.tsx`
- Create: `examples/mission-control/client/components/PlanningView.tsx`
- Create: `examples/mission-control/client/components/CountdownView.tsx`
- Create: `examples/mission-control/client/components/ScrubbedView.tsx`
- Create: `examples/mission-control/client/components/TerminalViews.tsx`

- [ ] **Step 1: Implement MissionDetail**

Uses `client.connect(missionDef, id)` + `useWorkflow()`. Shows loading state. Uses `wf.match()` to dispatch to the correct view component.

- [ ] **Step 2: Implement PlanningView**

Displays mission data (name, destination, crew, fuel). "Initiate Countdown" button dispatches `InitiateCountdown`. "Cancel Mission" button with reason input dispatches `CancelMission`. Shows `isDispatching` state on buttons.

- [ ] **Step 3: Implement CountdownView**

Large GO/NO-GO badge (green/red based on `telemetryStatus`). "LAUNCH" button (cyan, dispatches `Launch`). "SCRUB" button (amber outline, dispatches `ScrubLaunch` with reason input).

- [ ] **Step 4: Implement ScrubbedView**

Amber accent. Shows reason, attempt number. "Retry Countdown" button dispatches `RetryCountdown`.

- [ ] **Step 5: Implement TerminalViews**

- `OrbitAchievedView`: Green success styling, final stats grid (altitude, velocity, time in flight).
- `AbortView`: Red alert border, abort reason, last known altitude.
- `CancelledView`: Muted styling, cancellation reason.

- [ ] **Step 6: Commit**

```bash
git add examples/mission-control/client/components/ && git commit -m "feat: add state-specific mission detail views"
```

---

### Task 12: SVG trajectory visualization

The hero visualization for the Ascending state.

**Files:**
- Create: `examples/mission-control/client/components/viz/TrajectoryViz.tsx`
- Create: `examples/mission-control/client/components/viz/TelemetryGauge.tsx`
- Create: `examples/mission-control/client/components/viz/AltitudeChart.tsx`

- [ ] **Step 1: Implement TrajectoryViz**

Pure SVG component. Props: `altitude: number` (0-500km), `maxAltitude: number` (400km orbit line).

Elements:
- Viewbox: `0 0 600 400`
- Earth curvature: large arc at the bottom with gradient fill (dark blue → atmosphere blue)
- Atmosphere layer: semi-transparent gradient from Earth surface upward
- Orbit altitude line: dashed horizontal line at 400km position
- Altitude markers: text labels on left axis (0, 100, 200, 300, 400 km)
- Rocket icon: small SVG rocket shape positioned along a trajectory curve based on altitude
- Trajectory trail: path from launch point to current position, cyan glow
- CSS transitions on rocket position for smooth animation between telemetry updates
- Stars: scattered small circles in the upper portion (static)

- [ ] **Step 2: Implement TelemetryGauge**

SVG circular arc gauge. Props: `value: number`, `min: number`, `max: number`, `label: string`, `unit: string`.

Elements:
- Background arc (dark)
- Value arc (cyan, amber near max)
- Center: digital value readout in monospace font
- Bottom: label text
- Size: 120x120px per gauge

Used for altitude (0-500km), velocity (0-10km/s), heading (0-360°).

- [ ] **Step 3: Implement AltitudeChart**

SVG sparkline. Props: `readings: TelemetryReading[]`.

Elements:
- Line chart of altitude over time
- Cyan stroke, subtle gradient fill below line
- Y-axis: 0 to max altitude
- X-axis: reading index (simple, no time labels needed)
- Viewbox scales to fit data

- [ ] **Step 4: Commit**

```bash
git add examples/mission-control/client/components/viz/ && git commit -m "feat: add SVG trajectory, gauge, and chart visualizations"
```

---

### Task 13: Ascending view (hero dashboard)

Assembles the visualizations into the live telemetry dashboard.

**Files:**
- Create: `examples/mission-control/client/components/AscendingView.tsx`

- [ ] **Step 1: Implement AscendingView**

Layout:
- Top: Mission name + "ASCENDING" badge with cyan pulse animation
- Center: `<TrajectoryViz altitude={data.altitude} />`
- Below: Three `<TelemetryGauge>` components side by side (altitude, velocity, heading)
- Bottom: `<AltitudeChart readings={data.telemetryReadings} />`
- Status: "NOMINAL" (green) or "ANOMALY" (red) indicator based on latest telemetry

All data comes from `data` prop (the Ascending state data from the workflow). Live updates arrive via SSE → `useWorkflow` → re-render.

- [ ] **Step 2: Full integration test**

Start server + Redis + Vite. Create a mission, initiate countdown, launch. Verify the ascending view shows and updates live as the tracking loop pushes telemetry.

- [ ] **Step 3: Commit**

```bash
git add examples/mission-control/client/components/AscendingView.tsx && git commit -m "feat: add ascending view with live telemetry dashboard"
```

---

### Task 14: Polish and Playwright verification

Final UI polish + automated visual verification.

**Files:**
- Modify: Various client files for styling tweaks

- [ ] **Step 1: Polish UI**

- Ensure all views use consistent spacing, fonts, and colors from the design spec
- Add pulse animation to "ASCENDING" badge
- Add subtle glow effects on active buttons
- Verify monospace font on all telemetry readouts
- Test responsive layout

- [ ] **Step 2: Playwright verification**

Use `playwright-cli` skill to verify:
1. Create a mission — fill form, submit, verify appears in list
2. Initiate countdown — click button, verify GO badge appears
3. Launch — click launch, verify state changes to Ascending
4. Ascending dashboard — verify SVG elements exist, telemetry gauges update
5. Screenshot each state for visual verification

- [ ] **Step 3: Commit**

```bash
git add examples/mission-control/ && git commit -m "feat: polish UI and add Playwright verification"
```

---

### Task 15: Final verification and docs

- [ ] **Step 1: Run all server tests**

```bash
cd examples/mission-control && bun test
```

Expected: All pass.

- [ ] **Step 2: Typecheck**

```bash
cd examples/mission-control && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.server.json
```

Expected: Clean.

- [ ] **Step 3: Update README with final instructions**

Verify the README covers: prerequisites, setup, development workflow, architecture, screenshots.

- [ ] **Step 4: Full smoke test**

```bash
docker compose up -d
bun run dev:server &
npx vite &
# Create mission via UI, run through full lifecycle
```

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "chore: finalize mission-control example" && git push
```
