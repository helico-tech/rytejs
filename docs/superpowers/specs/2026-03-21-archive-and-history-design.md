# Mission Archive & History — Design Spec

## Overview

Two features for the mission-control-cloudflare example:
1. **Archive/Unarchive** — workflow-level archiving of completed missions, hidden from the default sidebar view but viewable via a toggle
2. **History Panel** — chronological audit trail of all commands dispatched and events emitted for a mission, with live updates

## 1. Archive — Workflow State

### Workflow Definition Changes (`shared/mission.ts`)

**New state: `Archived`**

Uses `z.enum(["OrbitAchieved", "AbortSequence", "Cancelled"])` for `previousState`. Includes shared fields (`name`, `destination`, `crewMembers`) as required, and all terminal-specific fields as optional:

```typescript
Archived: z.object({
	previousState: z.enum(["OrbitAchieved", "AbortSequence", "Cancelled"]),
	name: z.string(),
	destination: z.string(),
	crewMembers: z.array(z.string()),
	// OrbitAchieved fields (optional)
	fuelLevel: z.number().optional(),
	launchedAt: z.string().optional(),
	altitude: z.number().optional(),
	velocity: z.number().optional(),
	heading: z.number().optional(),
	telemetryReadings: z.array(...).optional(),
	orbitAchievedAt: z.string().optional(),
	finalAltitude: z.number().optional(),
	// AbortSequence fields (optional)
	abortedAt: z.string().optional(),
	reason: z.string().optional(), // shared by AbortSequence + Cancelled
	lastKnownAltitude: z.number().optional(),
	// Cancelled fields (optional)
	cancelledAt: z.string().optional(),
})
```

**New commands:**
- `Archive` — payload: `{}`
- `Unarchive` — payload: `{}`

**New events:**
- `MissionArchived` — data: `{ previousState: string }`
- `MissionUnarchived` — data: `{ restoredState: string }`

### Router Changes (`worker/router.ts`)

**Archive handlers** on each terminal state:
- `OrbitAchieved.on("Archive")` → emit `MissionArchived`, transition to `Archived` with `previousState: "OrbitAchieved"` + current data
- `AbortSequence.on("Archive")` → emit `MissionArchived`, transition to `Archived` with `previousState: "AbortSequence"` + current data
- `Cancelled.on("Archive")` → emit `MissionArchived`, transition to `Archived` with `previousState: "Cancelled"` + current data

**Unarchive handler** on `Archived` — uses conditional branching since `transition()` requires static state names:
```typescript
Archived.on("Unarchive", ({ data, transition, emit }) => {
	emit({ type: "MissionUnarchived", data: { restoredState: data.previousState } });
	const { previousState, ...rest } = data;
	if (previousState === "OrbitAchieved") transition("OrbitAchieved", rest);
	else if (previousState === "AbortSequence") transition("AbortSequence", rest);
	else if (previousState === "Cancelled") transition("Cancelled", rest);
});
```

### No Backend Infrastructure Changes

The MissionIndexDO already stores the snapshot, which includes `state`. Filtering by `state === "Archived"` vs not is done on the frontend. No new API routes, no new storage keys, no DO changes needed.

## 2. History — DO Storage

### MissionDO Storage Additions

**New storage keys:**
- `history:{missionId}:{zero-padded sequence}` — individual history entry (e.g., `history:abc:000042`)
- `historySeq:{missionId}` — auto-incrementing sequence counter (starts at 0)

Zero-padded sequence numbers ensure correct lexicographic ordering via `storage.list()`.

**History entry schema:**
```typescript
interface HistoryEntry {
	seq: number;
	timestamp: string; // ISO 8601
	type: "command" | "event";
	name: string; // e.g. "InitiateCountdown", "CountdownStarted"
	data: Record<string, unknown>; // command payload or event data
}
```

### Recording Logic

After each successful `executor.execute()` — in **both `fetch()` and `alarm()`**:
1. Read current sequence from `historySeq:{missionId}` (default 0)
2. Create one `command` entry: `{ seq, timestamp, type: "command", name: command.type, data: command.payload }`
3. Create one `event` entry per emitted event: `{ seq, timestamp, type: "event", name: event.type, data: event.data }`
4. Write all entries to storage and update the sequence counter
5. Include new entries in the WebSocket broadcast

Extract a shared `recordHistory(missionId, command, result)` helper called from both `fetch()` and `alarm()`.

### MissionDO HTTP Addition

- `GET /api/missions/:id/history` — list all `history:{missionId}:` prefixed keys from storage via `storage.list()`, return as ordered array (already sorted by zero-padded sequence)

### MissionDO WebSocket Changes

The existing MissionDO WebSocket sends `BroadcastMessage` from `@rytejs/react`:
```typescript
{ snapshot: WorkflowSnapshot, version: number, events: Array<{ type: string; data: unknown }> }
```

**History is delivered via a hybrid approach:**
- **Initial load:** `MissionDetail` fetches full history via `GET /api/missions/:id/history` on mount
- **Live updates:** New history entries are derived client-side from the `events` array already present in each `BroadcastMessage`, plus the command that triggered the update

This avoids changing the `@rytejs/react` `BroadcastMessage` type or the WebSocket protocol. The client maintains its own history state by appending entries as updates arrive.

### Worker Routing Addition

- `GET /api/missions/:id/history` → forward to MissionDO

## 3. Frontend — Sidebar Archive Toggle

### MissionList Changes

- Add a toggle below the header that switches between "Active" and "Archived" views
- Filter: "Active" = `snapshot.state !== "Archived"`, "Archived" = `snapshot.state === "Archived"`
- "New Mission" button hidden when viewing the archive
- Toggle is a simple two-segment control
- Add `Archived` entry to `stateBadgeClass` mapping (gray/muted styling)

## 4. Frontend — Archive/Unarchive Buttons

### Terminal State Views

OrbitAchievedView, AbortView, CancelledView each get an "Archive Mission" button that dispatches the `Archive` command. On success, the mission moves to the archived list and the detail view deselects (navigates to `/`).

### ArchivedView (new component)

Renders the archived mission data based on `previousState`:
- If `previousState === "OrbitAchieved"` → show orbit details (read-only)
- If `previousState === "AbortSequence"` → show abort details (read-only)
- If `previousState === "Cancelled"` → show cancellation details (read-only)

Plus an "Unarchive" button that dispatches the `Unarchive` command, returning the mission to its original terminal state.

## 5. Frontend — History Panel

### HistoryPanel Component

Placed below the state-specific view in MissionDetail. Vertical timeline layout:
- Each entry shows an icon/color: commands in blue, events in green
- Entry name (e.g. "InitiateCountdown", "Launched")
- Relative timestamp
- Expandable payload data (collapsed by default)
- Most recent entries at the top

### Data Flow

- MissionDetail manages history state separately from the workflow hook
- On mount: fetches full history via `GET /api/missions/:id/history`
- On updates: the `@rytejs/react` store broadcasts `BroadcastMessage` with `events`; the component derives new history entries from the command that triggered the update + the emitted events, and appends to local state
- No WebSocket protocol changes needed

### MissionDetail Changes

- Add `Archived` branch to `wf.match()` that renders `ArchivedView`
- Manage history state (`useState<HistoryEntry[]>`) and fetch on mount
- Subscribe to workflow store updates to derive incremental history entries
- Render `HistoryPanel` below the state-specific view

## 6. Notes

- **Deletion** — `deleteAll()` on the MissionDO clears history entries along with everything else. This is correct: deleting a mission deletes its history.
- **History volume** — ascending phase generates telemetry every 2s. For a demo this is fine. No pagination needed.

## 7. Summary of Files to Change

**Shared:**
- `shared/mission.ts` — add Archived state, Archive/Unarchive commands, MissionArchived/MissionUnarchived events

**Worker:**
- `worker/router.ts` — add Archive/Unarchive handlers for terminal states + Archived state
- `worker/mission-do.ts` — history recording (shared helper for fetch + alarm), history HTTP endpoint
- `worker/index.ts` — add `/api/missions/:id/history` route

**Frontend:**
- `client/components/MissionList.tsx` — archive toggle, filtering, Archived badge style
- `client/components/MissionDetail.tsx` — Archived branch in wf.match(), history state, HistoryPanel rendering
- `client/components/TerminalViews.tsx` — add Archive buttons to terminal views
- `client/components/ArchivedView.tsx` — new component for archived mission display
- `client/components/HistoryPanel.tsx` — new component for history timeline
