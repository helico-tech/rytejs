# Mission Archive & History — Design Spec

## Overview

Two features for the mission-control-cloudflare example:
1. **Archive/Unarchive** — workflow-level archiving of completed missions, hidden from the default sidebar view but viewable via a toggle
2. **History Panel** — chronological audit trail of all commands dispatched and events emitted for a mission, with live updates

## 1. Archive — Workflow State

### Workflow Definition Changes (`shared/mission.ts`)

**New state: `Archived`**
- Data schema carries all possible terminal state fields (orbit data, abort data, cancellation data) plus `previousState: string` to know which terminal state it came from
- This is a union of OrbitAchieved, AbortSequence, and Cancelled data fields, all optional except `previousState`

**New commands:**
- `Archive` — payload: `{}` (no additional data needed)
- `Unarchive` — payload: `{}` (no additional data needed)

### Router Changes (`worker/router.ts`)

**Archive handlers** on each terminal state:
- `OrbitAchieved.on("Archive")` → transition to `Archived` with `previousState: "OrbitAchieved"` + current data
- `AbortSequence.on("Archive")` → transition to `Archived` with `previousState: "AbortSequence"` + current data
- `Cancelled.on("Archive")` → transition to `Archived` with `previousState: "Cancelled"` + current data

**Unarchive handler** on `Archived`:
- `Archived.on("Unarchive")` → transition back to `previousState` with the stored data (minus `previousState` field)

### No Backend Infrastructure Changes

The MissionIndexDO already stores the snapshot, which includes `state`. Filtering by `state === "Archived"` vs not is done on the frontend. No new API routes, no new storage keys, no DO changes needed.

## 2. History — DO Storage

### MissionDO Storage Additions

**New storage keys:**
- `history:{missionId}:{sequence}` — individual history entry
- `historySeq:{missionId}` — auto-incrementing sequence counter (starts at 0)

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

After each successful `executor.execute()` in `MissionDO.fetch()`:
1. Read current sequence from `historySeq:{missionId}` (default 0)
2. Create one `command` entry: `{ seq, timestamp, type: "command", name: command.type, data: command.payload }`
3. Create one `event` entry per emitted event: `{ seq, timestamp, type: "event", name: event.type, data: event.data }`
4. Write all entries to storage and update the sequence counter
5. Include new entries in the WebSocket broadcast

### MissionDO HTTP Addition

- `GET /api/missions/:id/history` — load all `history:{missionId}:*` keys from storage, return as ordered array

### MissionDO WebSocket Changes

Current message format:
```json
{ "type": "init", "snapshot": {...}, "version": 1 }
{ "type": "update", "snapshot": {...}, "version": 2 }
```

New message format:
```json
{ "type": "init", "snapshot": {...}, "version": 1, "history": [...] }
{ "type": "update", "snapshot": {...}, "version": 2, "newHistory": [...] }
```

### Worker Routing Addition

- `GET /api/missions/:id/history` → forward to MissionDO

## 3. Frontend — Sidebar Archive Toggle

### MissionList Changes

- Add a toggle below the header that switches between "Active" and "Archived" views
- Filter: "Active" = `snapshot.state !== "Archived"`, "Archived" = `snapshot.state === "Archived"`
- "New Mission" button hidden when viewing the archive
- Toggle is a simple two-segment control or text toggle

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
- On mount: connects to WebSocket, receives `init` message with full `history` array
- On updates: receives `update` messages with `newHistory` entries, appends to local state
- History is fetched/received through the existing mission WebSocket connection (no separate connection)

## 6. Summary of Files to Change

**Shared:**
- `shared/mission.ts` — add Archived state, Archive/Unarchive commands + events

**Worker:**
- `worker/router.ts` — add Archive/Unarchive handlers
- `worker/mission-do.ts` — history recording, history loading, WebSocket message changes
- `worker/index.ts` — add `/api/missions/:id/history` route

**Frontend:**
- `client/components/MissionList.tsx` — archive toggle, filtering
- `client/components/MissionDetail.tsx` — history state management, render HistoryPanel
- `client/components/TerminalViews.tsx` — add Archive buttons to terminal views
- `client/components/ArchivedView.tsx` — new component for archived mission display
- `client/components/HistoryPanel.tsx` — new component for history timeline
