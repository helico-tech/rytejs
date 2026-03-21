# Mission Archive & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add archive/unarchive workflow states and a command+event history panel to the mission-control-cloudflare example.

**Architecture:** Archive is a workflow-level concern — a new `Archived` state reachable from terminal states via `Archive` command, reversible via `Unarchive`. History is stored per-mission in Durable Object storage, recorded after every `executor.execute()`, loaded via HTTP on mount, and updated live by deriving entries from `BroadcastMessage.events`.

**Tech Stack:** @rytejs/core (workflow definition + router), Cloudflare Durable Objects (storage), React + @rytejs/react (frontend), Tailwind CSS (styling)

**Spec:** `docs/superpowers/specs/2026-03-21-archive-and-history-design.md`

---

### Task 1: Add Archived state, Archive/Unarchive commands+events to workflow definition

**Files:**
- Modify: `examples/mission-control-cloudflare/shared/mission.ts`

- [ ] **Step 1: Add new events to the events object (after line 105)**

Add `MissionArchived` and `MissionUnarchived` events:

```typescript
MissionArchived: z.object({ missionId: z.string(), previousState: z.string() }),
MissionUnarchived: z.object({ missionId: z.string(), restoredState: z.string() }),
```

- [ ] **Step 2: Add new commands to the commands object (after line 95)**

```typescript
Archive: z.object({}),
Unarchive: z.object({}),
```

- [ ] **Step 3: Add Archived state to the states object (after the Cancelled state, line 80)**

```typescript
Archived: z.object({
	previousState: z.enum(["OrbitAchieved", "AbortSequence", "Cancelled"]),
	name: z.string(),
	destination: z.string(),
	crewMembers: z.array(z.string()),
	// OrbitAchieved fields
	fuelLevel: z.number().optional(),
	launchedAt: z.coerce.date().optional(),
	altitude: z.number().optional(),
	velocity: z.number().optional(),
	heading: z.number().optional(),
	telemetryReadings: z.array(TelemetryReadingSchema).optional(),
	orbitAchievedAt: z.coerce.date().optional(),
	finalAltitude: z.number().optional(),
	// AbortSequence fields
	abortedAt: z.coerce.date().optional(),
	reason: z.string().optional(),
	lastKnownAltitude: z.number().optional(),
	// Cancelled fields
	cancelledAt: z.coerce.date().optional(),
}),
```

- [ ] **Step 4: Commit**

```bash
git add examples/mission-control-cloudflare/shared/mission.ts
git commit -m "feat: add Archived state, Archive/Unarchive commands+events to mission workflow"
```

---

### Task 2: Add Archive/Unarchive router handlers

**Files:**
- Modify: `examples/mission-control-cloudflare/worker/router.ts`

- [ ] **Step 1: Add Archive handler to OrbitAchieved state (after the Ascending state block, line 169)**

```typescript
router.state("OrbitAchieved", ({ on }) => {
	on("Archive", ({ data, transition, emit, workflow }) => {
		transition("Archived", {
			previousState: "OrbitAchieved" as const,
			...data,
		});
		emit({
			type: "MissionArchived",
			data: { missionId: workflow.id, previousState: "OrbitAchieved" },
		});
	});
});
```

- [ ] **Step 2: Add Archive handler to AbortSequence state**

```typescript
router.state("AbortSequence", ({ on }) => {
	on("Archive", ({ data, transition, emit, workflow }) => {
		transition("Archived", {
			previousState: "AbortSequence" as const,
			...data,
		});
		emit({
			type: "MissionArchived",
			data: { missionId: workflow.id, previousState: "AbortSequence" },
		});
	});
});
```

- [ ] **Step 3: Add Archive handler to Cancelled state**

```typescript
router.state("Cancelled", ({ on }) => {
	on("Archive", ({ data, transition, emit, workflow }) => {
		transition("Archived", {
			previousState: "Cancelled" as const,
			...data,
		});
		emit({
			type: "MissionArchived",
			data: { missionId: workflow.id, previousState: "Cancelled" },
		});
	});
});
```

- [ ] **Step 4: Add Unarchive handler to Archived state**

Uses conditional branching since `transition()` requires static state names:

```typescript
router.state("Archived", ({ on }) => {
	on("Unarchive", ({ data, transition, emit, workflow }) => {
		const { previousState, ...rest } = data;
		emit({
			type: "MissionUnarchived",
			data: { missionId: workflow.id, restoredState: previousState },
		});
		if (previousState === "OrbitAchieved") {
			transition("OrbitAchieved", rest);
		} else if (previousState === "AbortSequence") {
			transition("AbortSequence", rest);
		} else {
			transition("Cancelled", rest);
		}
	});
});
```

- [ ] **Step 5: Rebuild core dist** (required for downstream packages)

```bash
cd packages/core && pnpm exec tsup
```

- [ ] **Step 6: Commit**

```bash
git add examples/mission-control-cloudflare/worker/router.ts
git commit -m "feat: add Archive/Unarchive handlers for terminal states"
```

---

### Task 3: Add history recording and HTTP endpoint to MissionDO

**Files:**
- Modify: `examples/mission-control-cloudflare/worker/mission-do.ts`

- [ ] **Step 1: Add HistoryEntry type and recordHistory helper method to MissionDO class**

Add after the `getMissionId` method (line 247):

```typescript
private async recordHistory(
	missionId: string,
	command: { type: string; payload: unknown },
	result: { ok: true; events: Array<{ type: string; data: unknown }>; [key: string]: unknown },
): Promise<HistoryEntry[]> {
	const seqKey = `historySeq:${missionId}`;
	let seq = (await this.ctx.storage.get<number>(seqKey)) ?? 0;
	const timestamp = new Date().toISOString();
	const entries: HistoryEntry[] = [];

	// Record command
	const cmdEntry: HistoryEntry = {
		seq,
		timestamp,
		type: "command",
		name: command.type,
		data: command.payload as Record<string, unknown>,
	};
	await this.ctx.storage.put(`history:${missionId}:${String(seq).padStart(6, "0")}`, cmdEntry);
	entries.push(cmdEntry);
	seq++;

	// Record each event
	for (const event of result.events) {
		const evtEntry: HistoryEntry = {
			seq,
			timestamp,
			type: "event",
			name: event.type,
			data: event.data as Record<string, unknown>,
		};
		await this.ctx.storage.put(`history:${missionId}:${String(seq).padStart(6, "0")}`, evtEntry);
		entries.push(evtEntry);
		seq++;
	}

	await this.ctx.storage.put(seqKey, seq);
	return entries;
}
```

Add the HistoryEntry interface at the top of the file (after imports):

```typescript
interface HistoryEntry {
	seq: number;
	timestamp: string;
	type: "command" | "event";
	name: string;
	data: Record<string, unknown>;
}
```

- [ ] **Step 2: Add history recording to the POST handler in fetch()**

After `const result = await this.executor.execute(id, body);` (line 72), inside the `if (result.ok)` block, add:

```typescript
await this.recordHistory(id, body, result);
```

- [ ] **Step 3: Add history recording to alarm()**

After each successful `this.executor.execute()` call in `alarm()` (there are 3 places: countdown tick line 133, launch line 148, ascending line 182), add inside the `if (result.ok)` block:

```typescript
await this.recordHistory(id, command, result);
```

For the countdown section where commands are inline, capture them in a variable first. The countdown `if` branch builds `UpdateCountdown` or `Launch` commands — use the same variable pattern as the ascending block.

- [ ] **Step 4: Add GET /history handler to fetch()**

Add before the DELETE handler (before line 96):

```typescript
// GET with /history path — load history
if (method === "GET") {
	const url = new URL(request.url);
	if (url.pathname.endsWith("/history")) {
		const id = await this.getMissionId();
		if (!id) return Response.json({ error: "No mission" }, { status: 404 });
		const historyMap = await this.ctx.storage.list<HistoryEntry>({
			prefix: `history:${id}:`,
		});
		const history = [...historyMap.values()];
		return Response.json(history);
	}
```

Restructure the existing GET handler so `/history` is checked first, then the regular GET loads the snapshot.

- [ ] **Step 5: Commit**

```bash
git add examples/mission-control-cloudflare/worker/mission-do.ts
git commit -m "feat: add history recording and /history endpoint to MissionDO"
```

---

### Task 4: Add /history route to worker

**Files:**
- Modify: `examples/mission-control-cloudflare/worker/index.ts`

- [ ] **Step 1: Expand the route regex to also match /api/missions/:id/history**

Change the regex on line 68 from:
```typescript
const match = pathname.match(/^\/api\/missions\/([^/]+)(\/ws)?$/);
```
to:
```typescript
const match = pathname.match(/^\/api\/missions\/([^/]+)(\/ws|\/history)?$/);
```

- [ ] **Step 2: Add history route handling**

After the `isWs` check (line 71), add:

```typescript
const isHistory = match[2] === "/history";
```

After the WebSocket block (line 80), add:

```typescript
if (isHistory && request.method === "GET") {
	return stub.fetch(new Request(new URL(`/history`, request.url), { method: "GET" }));
}
```

- [ ] **Step 3: Commit**

```bash
git add examples/mission-control-cloudflare/worker/index.ts
git commit -m "feat: add /api/missions/:id/history route"
```

---

### Task 5: Add ArchivedView component

**Files:**
- Create: `examples/mission-control-cloudflare/client/components/ArchivedView.tsx`

- [ ] **Step 1: Create ArchivedView component**

Renders archived mission content based on `previousState`, with an "Unarchive" button.

```tsx
import { useCallback, useState } from "react";
import { cn } from "../lib/utils.ts";
import { TrajectoryViz } from "./viz/TrajectoryViz.tsx";

interface ArchivedData {
	previousState: "OrbitAchieved" | "AbortSequence" | "Cancelled";
	name: string;
	destination: string;
	crewMembers: string[];
	// OrbitAchieved
	fuelLevel?: number;
	launchedAt?: Date;
	altitude?: number;
	velocity?: number;
	heading?: number;
	orbitAchievedAt?: Date;
	finalAltitude?: number;
	// AbortSequence
	abortedAt?: Date;
	reason?: string;
	lastKnownAltitude?: number;
	// Cancelled
	cancelledAt?: Date;
}

interface ArchivedViewProps {
	data: ArchivedData;
	dispatch: (command: { type: string; payload: unknown }) => Promise<unknown>;
	isDispatching: boolean;
}

export function ArchivedView({ data, dispatch, isDispatching }: ArchivedViewProps) {
	const [isUnarchiving, setIsUnarchiving] = useState(false);

	const handleUnarchive = useCallback(async () => {
		setIsUnarchiving(true);
		try {
			await dispatch({ type: "Unarchive", payload: {} });
		} finally {
			setIsUnarchiving(false);
		}
	}, [dispatch]);

	return (
		<div className="max-w-3xl mx-auto space-y-6">
			{/* Archived banner */}
			<div className="rounded-lg border border-[hsl(var(--muted))]/50 bg-[hsl(var(--muted))]/10 p-4 flex items-center justify-between">
				<div>
					<div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
						Archived — previously {data.previousState}
					</div>
					<div className="text-xs text-[hsl(var(--muted-foreground))]/70">
						{data.name}
					</div>
				</div>
				<button
					type="button"
					onClick={handleUnarchive}
					disabled={isDispatching || isUnarchiving}
					className={cn(
						"px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
						"bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]",
						"hover:bg-[hsl(var(--primary))]/20",
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
				>
					{isUnarchiving ? "Unarchiving..." : "Unarchive"}
				</button>
			</div>

			{/* Render content based on previousState */}
			<div className="opacity-75">
				{data.previousState === "OrbitAchieved" && <ArchivedOrbit data={data} />}
				{data.previousState === "AbortSequence" && <ArchivedAbort data={data} />}
				{data.previousState === "Cancelled" && <ArchivedCancelled data={data} />}
			</div>
		</div>
	);
}
```

Add the three sub-components (`ArchivedOrbit`, `ArchivedAbort`, `ArchivedCancelled`) in the same file. They are read-only versions of the terminal views — reuse the same layout/styling but without action buttons. Keep them concise — extract the key info (stats, reason, crew).

- [ ] **Step 2: Commit**

```bash
git add examples/mission-control-cloudflare/client/components/ArchivedView.tsx
git commit -m "feat: add ArchivedView component"
```

---

### Task 6: Add HistoryPanel component

**Files:**
- Create: `examples/mission-control-cloudflare/client/components/HistoryPanel.tsx`

- [ ] **Step 1: Create HistoryPanel component**

Vertical timeline layout. Commands in blue, events in green. Most recent at top. Expandable payload data.

```tsx
import { useState } from "react";
import { cn } from "../lib/utils.ts";

export interface HistoryEntry {
	seq: number;
	timestamp: string;
	type: "command" | "event";
	name: string;
	data: Record<string, unknown>;
}

interface HistoryPanelProps {
	entries: HistoryEntry[];
}

export function HistoryPanel({ entries }: HistoryPanelProps) {
	if (entries.length === 0) return null;

	// Most recent at top
	const sorted = [...entries].sort((a, b) => b.seq - a.seq);

	return (
		<div className="mt-8 max-w-3xl mx-auto">
			<h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-4">
				History
			</h3>
			<div className="space-y-1">
				{sorted.map((entry) => (
					<HistoryEntryRow key={entry.seq} entry={entry} />
				))}
			</div>
		</div>
	);
}
```

Add `HistoryEntryRow` component in the same file:
- Shows a colored dot (blue for command, green for event)
- Entry name
- Relative timestamp (e.g., "2s ago")
- Click to expand payload data as formatted JSON

- [ ] **Step 2: Commit**

```bash
git add examples/mission-control-cloudflare/client/components/HistoryPanel.tsx
git commit -m "feat: add HistoryPanel component"
```

---

### Task 7: Wire up Archive buttons in terminal views

**Files:**
- Modify: `examples/mission-control-cloudflare/client/components/TerminalViews.tsx`

- [ ] **Step 1: Add dispatch and isDispatching props to each terminal view**

Update `OrbitAchievedViewProps`, `AbortViewProps`, `CancelledViewProps` interfaces to accept:

```typescript
dispatch: (command: { type: string; payload: unknown }) => Promise<unknown>;
isDispatching: boolean;
onArchived?: () => void;
```

- [ ] **Step 2: Add Archive button to each terminal view component**

Add a shared archive handler and button to each view. Place the button after the main content, before the crew section:

```tsx
const [isArchiving, setIsArchiving] = useState(false);
const handleArchive = useCallback(async () => {
	setIsArchiving(true);
	try {
		await dispatch({ type: "Archive", payload: {} });
		onArchived?.();
	} finally {
		setIsArchiving(false);
	}
}, [dispatch, onArchived]);
```

Button JSX:
```tsx
<button
	type="button"
	onClick={handleArchive}
	disabled={isDispatching || isArchiving}
	className={cn(
		"px-4 py-2 text-sm font-medium rounded-md transition-colors",
		"bg-[hsl(var(--muted))]/20 text-[hsl(var(--muted-foreground))]",
		"hover:bg-[hsl(var(--muted))]/30",
		"disabled:opacity-50 disabled:cursor-not-allowed",
	)}
>
	{isArchiving ? "Archiving..." : "Archive Mission"}
</button>
```

Add necessary imports: `useCallback`, `useState` from react, `cn` from utils.

- [ ] **Step 3: Commit**

```bash
git add examples/mission-control-cloudflare/client/components/TerminalViews.tsx
git commit -m "feat: add Archive buttons to terminal state views"
```

---

### Task 8: Wire up MissionDetail with history and ArchivedView

**Files:**
- Modify: `examples/mission-control-cloudflare/client/components/MissionDetail.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { ArchivedView } from "./ArchivedView.tsx";
import { HistoryPanel, type HistoryEntry } from "./HistoryPanel.tsx";
```

- [ ] **Step 2: Add history state and fetch logic**

Inside `MissionDetail`, after the existing state declarations:

```typescript
const [history, setHistory] = useState<HistoryEntry[]>([]);

// Fetch history on mount
useEffect(() => {
	fetch(`/api/missions/${id}/history`)
		.then((res) => res.ok ? res.json() : [])
		.then((data: HistoryEntry[]) => setHistory(data))
		.catch(() => {});
}, [id]);
```

- [ ] **Step 3: Subscribe to store updates to derive new history entries**

After the history fetch effect, add another effect that subscribes to the workflow store for live updates. When a `BroadcastMessage` arrives (which includes `events`), derive history entries and append:

```typescript
useEffect(() => {
	const unsub = store.subscribe(() => {
		const snap = store.getSnapshot();
		if (!snap || snap.status !== "ready") return;
		// Re-fetch history to stay in sync (simplest approach)
		fetch(`/api/missions/${id}/history`)
			.then((res) => res.ok ? res.json() : [])
			.then((data: HistoryEntry[]) => setHistory(data))
			.catch(() => {});
	});
	return unsub;
}, [store, id]);
```

Note: Re-fetching full history on each update is simplest for a demo. The history is small and the requests are local to the DO.

- [ ] **Step 4: Add Archived branch to wf.match() and pass dispatch to terminal views**

Update the match object (line 77-91):

```typescript
{
	Planning: (data) => (
		<PlanningView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
	),
	Countdown: (data) => (
		<CountdownView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
	),
	Scrubbed: (data) => (
		<ScrubbedView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
	),
	Ascending: (data) => <AscendingView data={data} />,
	OrbitAchieved: (data) => (
		<OrbitAchievedView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} onArchived={() => onDeleted?.()} />
	),
	AbortSequence: (data) => (
		<AbortView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} onArchived={() => onDeleted?.()} />
	),
	Cancelled: (data) => (
		<CancelledView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} onArchived={() => onDeleted?.()} />
	),
	Archived: (data) => (
		<ArchivedView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
	),
}
```

- [ ] **Step 5: Render HistoryPanel below the state view**

After the `wf.match(...)` call, add:

```tsx
<HistoryPanel entries={history} />
```

- [ ] **Step 6: Add `useEffect` to imports**

Update the react import to include `useEffect`.

- [ ] **Step 7: Commit**

```bash
git add examples/mission-control-cloudflare/client/components/MissionDetail.tsx
git commit -m "feat: wire up MissionDetail with history panel and ArchivedView"
```

---

### Task 9: Add archive toggle to MissionList

**Files:**
- Modify: `examples/mission-control-cloudflare/client/components/MissionList.tsx`

- [ ] **Step 1: Add Archived badge style**

Add to `stateBadgeClass` (after line 25):

```typescript
Archived: "bg-[hsl(var(--muted))]/20 text-[hsl(var(--muted-foreground))]/70",
```

- [ ] **Step 2: Add showArchived state**

Inside the component, add:

```typescript
const [showArchived, setShowArchived] = useState(false);
```

- [ ] **Step 3: Add filtered missions computed value**

```typescript
const filteredMissions = missions.filter((m) =>
	showArchived ? m.snapshot.state === "Archived" : m.snapshot.state !== "Archived",
);
```

- [ ] **Step 4: Add toggle UI**

After the "New Mission" button block (line 116), add a toggle control:

```tsx
<div className="flex mt-2 rounded-md overflow-hidden border border-[hsl(var(--border))]">
	<button
		type="button"
		onClick={() => setShowArchived(false)}
		className={cn(
			"flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
			!showArchived
				? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
				: "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]",
		)}
	>
		Active
	</button>
	<button
		type="button"
		onClick={() => setShowArchived(true)}
		className={cn(
			"flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
			showArchived
				? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
				: "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]",
		)}
	>
		Archived
	</button>
</div>
```

- [ ] **Step 5: Hide "New Mission" button when viewing archived**

Wrap the "New Mission" button in a condition:

```tsx
{!showArchived && (
	<button ...>
		{showCreate ? "Cancel" : "+ New Mission"}
	</button>
)}
```

- [ ] **Step 6: Use filteredMissions instead of missions in the list render**

Replace `missions.map(...)` with `filteredMissions.map(...)` and update the empty state message:

```tsx
{filteredMissions.length === 0 && (
	<div className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
		{showArchived ? "No archived missions" : "No missions yet"}
	</div>
)}
```

- [ ] **Step 7: Update the mission count display**

Change `{missions.length}` to `{filteredMissions.length}`.

- [ ] **Step 8: Commit**

```bash
git add examples/mission-control-cloudflare/client/components/MissionList.tsx
git commit -m "feat: add archive toggle to mission list sidebar"
```

---

### Task 10: Manual testing and final cleanup

- [ ] **Step 1: Run `pnpm biome check --fix .` from workspace root**

Fix any lint issues introduced by the new code.

- [ ] **Step 2: Start the dev server and test the full flow**

```bash
cd examples/mission-control-cloudflare && pnpm dev
```

Test scenarios:
1. Create a mission, run it through to a terminal state (OrbitAchieved, AbortSequence, or Cancelled)
2. Verify the history panel shows commands and events as they happen
3. Click "Archive Mission" — mission should disappear from active list
4. Toggle to "Archived" view — mission should appear
5. Click on archived mission — should show ArchivedView with Unarchive button
6. Click "Unarchive" — mission should return to active list in its original terminal state
7. Verify history persists through archive/unarchive cycle

- [ ] **Step 3: Final commit and push**

```bash
git add -A examples/mission-control-cloudflare/
git commit -m "feat: mission archive and history panel for cloudflare example"
git push
```
