# Example Dashboard DevTools — Design Spec

**Goal:** Extend the `examples/react-order-dashboard` app with dispatch logging, time-travel debugging, and multi-workflow management to showcase `@rytejs/react` capabilities.

**Scope:** Example app only — no changes to `@rytejs/core` or `@rytejs/react`.

---

## Architecture

Three-column layout:

- **Left sidebar** — Order list: create new orders, select active order, delete orders
- **Center** — Current order view (existing workflow UI)
- **Right sidebar** — DevTools panel with two tabs: Log and Time Travel

A top-level `Dashboard` component manages:

- A registry of orders (metadata array persisted to localStorage)
- The currently selected order ID
- Per-order workflow stores (created on demand)
- Per-order dispatch log (in-memory, powers both the log display and time-travel)

---

## Data Model

### Order Registry

Persisted to `localStorage` under key `order-dashboard-registry`.

```ts
interface OrderEntry {
	id: string;
	customer: string;     // captured at creation time, not re-read from workflow data
	state: string;        // current workflow state name, updated after each dispatch
	createdAt: string;    // ISO date
}
```

**Note:** `customer` is set when the order is created (or when `SetCustomer` is dispatched) and stored in the registry entry directly. It is NOT re-read from `workflow.data` on each render, avoiding coupling to the workflow's state data shape.

Each order's workflow is persisted separately under `order-dashboard-{id}` (same mechanism as the current single-order persistence, but keyed per order).

### Dispatch Log Entry

In-memory, per order. Also serves as the time-travel snapshot stack.

```ts
interface LogEntry {
	id: number;                    // sequential, 0-based
	command: string;               // command name, "__init__" for initial state
	payload: unknown;              // command payload ({} for __init__)
	fromState: string;             // state before dispatch (same as toState for __init__)
	toState: string;               // state after dispatch (same as fromState on error)
	timestamp: number;             // Date.now()
	durationMs: number;            // dispatch duration in ms (0 for __init__)
	events: string[];              // emitted event type names ([] for __init__ and errors)
	error: {                       // null on success
		category: string;          // PipelineError category
		message: string;           // error message
		code?: string;             // domain error code, if applicable
	} | null;
	snapshot: WorkflowSnapshot;    // workflow snapshot AFTER this dispatch (or initial state for __init__)
}
```

Entry `0` is the initial state: `command: "__init__"`, `fromState` and `toState` both set to the initial state name, `snapshot` is the initial workflow snapshot.

### Time-Travel State

In-memory, per order.

```ts
interface TimeTravelState {
	entries: LogEntry[];
	cursor: number;    // index into entries; entries.length - 1 = live/latest state
}
```

Since `LogEntry.snapshot` stores the state AFTER each dispatch:
- **Undo**: decrement cursor, restore `entries[cursor].snapshot`
- **Redo**: increment cursor, restore `entries[cursor].snapshot`
- **Jump**: set cursor to target index, restore `entries[cursor].snapshot`
- **New dispatch while cursor < end**: truncate entries after cursor, append new entry, cursor moves to end

Snapshot restoration uses `definition.restore()` with result unwrapping:

```ts
const result = orderDefinition.restore(entries[cursor].snapshot);
if (result.ok) {
	store.setWorkflow(result.workflow);
}
```

---

## Dispatch Logging

**Approach:** Wrap dispatch at the store level, NOT via router middleware. Router middleware cannot observe state transitions because `ctx.workflow` is immutable within the middleware context. Instead, the `createOrderStore` wrapper captures before/after state from the `DispatchResult`:

```ts
// In createOrderStore wrapper
const beforeSnapshot = orderDefinition.snapshot(store.getWorkflow());
const beforeState = store.getWorkflow().state;
const start = performance.now();

const result = await store.dispatch(command, payload);

const durationMs = performance.now() - start;
const afterWorkflow = result.ok ? result.workflow : store.getWorkflow();
const afterSnapshot = orderDefinition.snapshot(afterWorkflow);

onLog?.({
	command,
	payload,
	fromState: beforeState,
	toState: afterWorkflow.state,
	durationMs,
	events: result.ok ? result.events.map(e => e.type) : [],
	error: result.ok ? null : {
		category: result.error.category,
		message: "message" in result.error
			? result.error.message
			: `Domain error: ${result.error.code}`,
		code: "code" in result.error ? result.error.code : undefined,
	},
	snapshot: afterSnapshot,
});
```

The `onLog` callback is provided by the Dashboard component. It pushes a new `LogEntry` into the order's log and advances the time-travel cursor.

**`DispatchResult` events access:** The `result.events` array is available on successful dispatch results from `@rytejs/core`. If the result type does not expose `events`, fall back to `[]` — the log will still show the command and state transition.

---

## Component Structure

### New Files

| File | Purpose |
|------|---------|
| `src/Dashboard.tsx` | Top-level 3-column layout. Manages order registry, active selection, store creation, and dispatch log state. |
| `src/components/OrderList.tsx` | Left sidebar. Renders order entries, "New Order" button, delete buttons. Shows active order highlighted. |
| `src/components/DevToolsPanel.tsx` | Right sidebar. Tab switcher between Log and Time Travel tabs. |
| `src/components/LogTab.tsx` | Scrollable list of dispatch log entries. Color-coded by outcome (success=green, error=red). Shows command name, state transition arrow, duration, events. |
| `src/components/TimeTravelTab.tsx` | Clickable vertical timeline of states. Undo/Redo buttons at top. Current cursor position highlighted. Each entry is clickable to jump directly. |

### Modified Files

| File | Changes |
|------|---------|
| `src/workflow.ts` | Modify `createOrderStore` to accept a persistence key and an `onLog` callback. The callback wraps `store.dispatch` to capture before/after snapshots. Export `orderDefinition` for snapshot/restore access. |
| `src/main.tsx` | Render `Dashboard` instead of wrapping `App` directly. |
| `src/App.tsx` | No structural changes — still consumes `OrderContext`. May add minor styling adjustments for the center column. |

### Existing Component Files (unchanged)

All view components (`DraftView`, `SubmittedView`, etc.) and `StepIndicator` remain as-is.

---

## Multi-Workflow Management

### Creating an Order

- "New Order" button in the left sidebar
- Creates a new order entry in the registry with a generated ID, empty customer, state "Draft"
- Creates a fresh workflow store for it
- Selects it as active

### Selecting an Order

- Click an order in the sidebar to select it
- The center view and DevTools update to show the selected order
- If the order's store hasn't been created yet (e.g., page refresh), create it from the persisted workflow snapshot
- If the persisted snapshot fails to restore (corrupt data), the order is removed from the registry and its localStorage entry is cleaned up. The next available order is selected, or empty state is shown.

### Deleting an Order

- Delete button (×) on each order entry, single click (no confirmation — example app)
- Removes from registry, removes `order-dashboard-{id}` from localStorage, removes in-memory store and log
- If the deleted order was active, select the first remaining order (or show empty state)

### Persistence

- Registry array persisted to `localStorage` under `order-dashboard-registry`
- Each order's workflow persisted to `localStorage` under `order-dashboard-{id}`
- On page load: read registry, lazily create stores as orders are selected
- Registry entry's `state` field is updated after each dispatch (for sidebar display)
- Registry entry's `customer` field is updated when `SetCustomer` is dispatched

---

## Time-Travel Behavior

1. **Initial state**: cursor at 0 (the `__init__` entry), no undo available
2. **After dispatches**: cursor advances with each successful or failed dispatch
3. **Undo**: cursor decrements, restores `entries[cursor].snapshot` via `store.setWorkflow()`
4. **Redo**: cursor increments, restores `entries[cursor].snapshot`
5. **Jump**: click any entry in the timeline, cursor jumps there, snapshot restored
6. **New dispatch while in past**: entries after cursor are truncated, new entry appended, cursor moves to end
7. **Visual indicator**: entries after cursor shown as dimmed in both Log and Timeline tabs
8. **During dispatch**: undo/redo/jump controls are disabled while `isDispatching` is true to prevent race conditions with in-flight dispatches

**Time-travel does NOT persist.** `store.setWorkflow()` does not write to localStorage. On page refresh, the app loads the last dispatched (persisted) state, and the dispatch log/time-travel history is reset. This is intentional — time-travel is a debug tool.

---

## Visual Design

### Left Sidebar (OrderList)

- Fixed width ~220px
- "New Order" button at top
- Order entries as cards: customer name (or "Untitled Order" if empty), state badge, created date
- Active order has highlighted border
- Delete button (×) on hover

### Right Sidebar (DevToolsPanel)

- Fixed width ~300px
- Tab bar: "Log" | "Time Travel"
- Both tabs scroll independently

### Log Tab

- Each entry is a compact row:
  - Colored dot (green=success, red=error, gray=init)
  - Command name in monospace
  - State transition: `Draft → Submitted`
  - Duration in ms
  - Events listed as small badges
  - Error message if present (red text, includes category)
- Auto-scrolls to latest entry
- Entries after time-travel cursor are dimmed

### Time Travel Tab

- Undo/Redo buttons at top (disabled when at bounds or during dispatch)
- Vertical timeline with connected dots
- Each node shows: command name, resulting state, timestamp
- Current cursor position has a filled/highlighted dot
- Future entries (after cursor) are dimmed
- Click any node to jump to that state

### Center Column

- Fills remaining space (flex: 1)
- Existing order view, unchanged

---

## Non-Goals

- No changes to `@rytejs/core` or `@rytejs/react` packages
- No network persistence or server-side storage
- No drag-and-drop reordering of orders
- No export/import of order data
- No keyboard shortcuts for time-travel (just buttons — keep it simple for an example)
