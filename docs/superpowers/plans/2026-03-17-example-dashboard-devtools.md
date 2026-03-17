# Example Dashboard DevTools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the react-order-dashboard example with a 3-column layout featuring multi-order management, dispatch logging, and time-travel debugging.

**Architecture:** Top-level `Dashboard` component manages an order registry (localStorage-persisted array of order metadata), per-order workflow stores (created on demand), and per-order dispatch logs (in-memory). Dispatch logging wraps `store.dispatch()` to capture before/after snapshots. Time-travel restores historical snapshots via `store.setWorkflow()`.

**Tech Stack:** React 19, TypeScript, Vite, @rytejs/core, @rytejs/react, inline styles

**Spec:** `docs/superpowers/specs/2026-03-17-example-dashboard-devtools-design.md`

---

## File Structure

```
examples/react-order-dashboard/src/
├── main.tsx                        # Entry point — renders Dashboard
├── App.tsx                         # Center column — existing order view (minor changes)
├── workflow.ts                     # Modified: export definition, new createOrderStore signature
├── types.ts                        # NEW: LogEntry, OrderEntry, TimeTravelState interfaces
├── use-order-manager.ts            # NEW: Hook managing registry, stores, logs, time-travel
├── Dashboard.tsx                   # NEW: 3-column layout, ties everything together
├── components/
│   ├── OrderList.tsx               # NEW: Left sidebar — order list, create, delete
│   ├── DevToolsPanel.tsx           # NEW: Right sidebar — tab switcher
│   ├── LogTab.tsx                  # NEW: Dispatch log entries
│   ├── TimeTravelTab.tsx           # NEW: Timeline + undo/redo
│   ├── DraftView.tsx               # Unchanged
│   ├── SubmittedView.tsx           # Unchanged
│   ├── ApprovedView.tsx            # Unchanged
│   ├── PaidView.tsx                # Unchanged
│   ├── ShippedView.tsx             # Unchanged
│   ├── DeliveredView.tsx           # Unchanged
│   ├── RejectedView.tsx            # Unchanged
│   ├── StepIndicator.tsx           # Unchanged
│   └── OrderSummary.tsx            # Unchanged
```

---

## Chunk 1: Data Types and Workflow Changes

### Task 1: Add shared type definitions

**Files:**
- Create: `examples/react-order-dashboard/src/types.ts`

- [ ] **Step 1: Create `types.ts`**

```typescript
import type { WorkflowSnapshot } from "@rytejs/core";
import type { OrderConfig } from "./workflow";

export interface OrderEntry {
	id: string;
	customer: string;
	state: string;
	createdAt: string;
}

export interface LogEntry {
	id: number;
	command: string;
	payload: unknown;
	fromState: string;
	toState: string;
	timestamp: number;
	durationMs: number;
	events: string[];
	error: {
		category: string;
		message: string;
		code?: string;
	} | null;
	snapshot: WorkflowSnapshot<OrderConfig>;
}

export interface TimeTravelState {
	entries: LogEntry[];
	cursor: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors (may fail if `OrderConfig` isn't exported yet — that's fine, we fix it in Task 2)

- [ ] **Step 3: Commit**

```bash
git add examples/react-order-dashboard/src/types.ts
git commit -m "feat(example): add devtools type definitions"
git push
```

---

### Task 2: Modify workflow.ts for multi-order support

**Files:**
- Modify: `examples/react-order-dashboard/src/workflow.ts`

- [ ] **Step 1: Export `orderDefinition` and add `createOrderStore` with logging callback**

Replace the existing `createOrderStore` function and add the `orderDefinition` export. The full updated `workflow.ts`:

```typescript
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { createWorkflowContext, createWorkflowStore } from "@rytejs/react";
import type { WorkflowStore } from "@rytejs/react";
import { z } from "zod";
import type { LogEntry } from "./types";

// --- Item schema ---

const itemSchema = z.object({
	name: z.string(),
	quantity: z.number().int().positive(),
	price: z.number().positive(),
});

export type Item = z.infer<typeof itemSchema>;

// --- Workflow definition ---

export const orderDefinition = defineWorkflow("order", {
	states: {
		Draft: z.object({ customer: z.string(), items: z.array(itemSchema) }),
		Submitted: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			submittedAt: z.coerce.date(),
		}),
		Approved: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			approvedBy: z.string(),
		}),
		Paid: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			paidAt: z.coerce.date(),
			transactionId: z.string(),
		}),
		Shipped: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			trackingNumber: z.string(),
			shippedAt: z.coerce.date(),
		}),
		Delivered: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			deliveredAt: z.coerce.date(),
		}),
		Rejected: z.object({
			customer: z.string(),
			items: z.array(itemSchema),
			reason: z.string(),
			rejectedAt: z.coerce.date(),
		}),
	},
	commands: {
		AddItem: z.object({
			name: z.string(),
			quantity: z.number().int().positive(),
			price: z.number().positive(),
		}),
		RemoveItem: z.object({ index: z.number().int().min(0) }),
		SetCustomer: z.object({ customer: z.string() }),
		Submit: z.object({}),
		Approve: z.object({ approvedBy: z.string() }),
		Reject: z.object({ reason: z.string() }),
		ProcessPayment: z.object({ transactionId: z.string() }),
		Ship: z.object({ trackingNumber: z.string() }),
		ConfirmDelivery: z.object({}),
		Resubmit: z.object({}),
	},
	events: {
		OrderSubmitted: z.object({ orderId: z.string(), customer: z.string(), itemCount: z.number() }),
		OrderApproved: z.object({ orderId: z.string(), approvedBy: z.string() }),
		OrderRejected: z.object({ orderId: z.string(), reason: z.string() }),
		PaymentProcessed: z.object({
			orderId: z.string(),
			transactionId: z.string(),
			amount: z.number(),
		}),
		OrderShipped: z.object({ orderId: z.string(), trackingNumber: z.string() }),
		OrderDelivered: z.object({ orderId: z.string() }),
	},
	errors: {
		EmptyOrder: z.object({}),
	},
});

export type OrderConfig = typeof orderDefinition.config;

// --- Router with handlers ---

const router = new WorkflowRouter(orderDefinition);

// Draft state: add/remove items, set customer, submit
router.state("Draft", ({ on }) => {
	on("AddItem", ({ data, command, update }) => {
		const newItem: Item = {
			name: command.payload.name,
			quantity: command.payload.quantity,
			price: command.payload.price,
		};
		update({ items: [...data.items, newItem] });
	});

	on("RemoveItem", ({ data, command, update }) => {
		const items = data.items.filter((_, i) => i !== command.payload.index);
		update({ items });
	});

	on("SetCustomer", ({ command, update }) => {
		update({ customer: command.payload.customer });
	});

	on("Submit", ({ data, workflow, transition, emit, error }) => {
		if (data.items.length === 0) {
			error({ code: "EmptyOrder", data: {} });
		}
		const now = new Date();
		transition("Submitted", {
			customer: data.customer,
			items: data.items,
			submittedAt: now,
		});
		emit({
			type: "OrderSubmitted",
			data: { orderId: workflow.id, customer: data.customer, itemCount: data.items.length },
		});
	});
});

// Submitted state: approve or reject
router.state("Submitted", ({ on }) => {
	on("Approve", ({ data, workflow, command, transition, emit }) => {
		transition("Approved", {
			customer: data.customer,
			items: data.items,
			approvedBy: command.payload.approvedBy,
		});
		emit({
			type: "OrderApproved",
			data: { orderId: workflow.id, approvedBy: command.payload.approvedBy },
		});
	});

	on("Reject", ({ data, workflow, command, transition, emit }) => {
		transition("Rejected", {
			customer: data.customer,
			items: data.items,
			reason: command.payload.reason,
			rejectedAt: new Date(),
		});
		emit({
			type: "OrderRejected",
			data: { orderId: workflow.id, reason: command.payload.reason },
		});
	});
});

// Approved state: process payment
router.state("Approved", ({ on }) => {
	on("ProcessPayment", ({ data, workflow, command, transition, emit }) => {
		const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		transition("Paid", {
			customer: data.customer,
			items: data.items,
			paidAt: new Date(),
			transactionId: command.payload.transactionId,
		});
		emit({
			type: "PaymentProcessed",
			data: { orderId: workflow.id, transactionId: command.payload.transactionId, amount: total },
		});
	});
});

// Paid state: ship
router.state("Paid", ({ on }) => {
	on("Ship", ({ data, workflow, command, transition, emit }) => {
		transition("Shipped", {
			customer: data.customer,
			items: data.items,
			trackingNumber: command.payload.trackingNumber,
			shippedAt: new Date(),
		});
		emit({
			type: "OrderShipped",
			data: { orderId: workflow.id, trackingNumber: command.payload.trackingNumber },
		});
	});
});

// Shipped state: confirm delivery
router.state("Shipped", ({ on }) => {
	on("ConfirmDelivery", ({ data, workflow, transition, emit }) => {
		transition("Delivered", {
			customer: data.customer,
			items: data.items,
			deliveredAt: new Date(),
		});
		emit({
			type: "OrderDelivered",
			data: { orderId: workflow.id },
		});
	});
});

// Rejected state: resubmit back to Draft
router.state("Rejected", ({ on }) => {
	on("Resubmit", ({ data, transition }) => {
		transition("Draft", {
			customer: data.customer,
			items: data.items,
		});
	});
});

// --- Context factory ---

export const OrderContext = createWorkflowContext(orderDefinition);

// --- Store factory ---

export interface OrderStoreOptions {
	persistKey: string;
	onLog?: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
}

export function createOrderStore(options: OrderStoreOptions): WorkflowStore<OrderConfig> {
	const store = createWorkflowStore(
		router,
		{
			state: "Draft" as const,
			data: { customer: "", items: [] },
		},
		{
			persist: {
				key: options.persistKey,
				storage: localStorage,
			},
		},
	);

	if (!options.onLog) {
		return store;
	}

	const onLog = options.onLog;
	const originalDispatch = store.dispatch;

	// Wrap dispatch to capture before/after snapshots for logging
	const wrappedDispatch: typeof originalDispatch = async (command, payload) => {
		const beforeWorkflow = store.getWorkflow();
		const fromState = beforeWorkflow.state;
		const start = performance.now();

		const result = await originalDispatch(command, payload);

		const durationMs = performance.now() - start;
		const afterWorkflow = result.ok ? result.workflow : store.getWorkflow();
		const afterSnapshot = orderDefinition.snapshot(afterWorkflow);

		onLog({
			command: command as string,
			payload,
			fromState: fromState as string,
			toState: afterWorkflow.state as string,
			durationMs,
			events: result.ok ? result.events.map((e) => e.type as string) : [],
			error: result.ok
				? null
				: {
						category: result.error.category,
						message:
							result.error.category === "domain"
								? `Domain error: ${result.error.code}`
								: result.error.message,
						code: "code" in result.error ? String(result.error.code) : undefined,
					},
			snapshot: afterSnapshot,
		});

		return result;
	};

	return {
		...store,
		dispatch: wrappedDispatch,
	};
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add examples/react-order-dashboard/src/workflow.ts examples/react-order-dashboard/src/types.ts
git commit -m "feat(example): refactor workflow.ts for multi-order support with logging"
git push
```

---

## Chunk 2: Order Manager Hook

### Task 3: Implement `useOrderManager` hook

This is the core state management hook. It manages the order registry, per-order stores, dispatch logs, and time-travel state. All state that the Dashboard needs flows through this hook.

**Files:**
- Create: `examples/react-order-dashboard/src/use-order-manager.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkflowStore } from "@rytejs/react";
import type { LogEntry, OrderEntry, TimeTravelState } from "./types";
import { type OrderConfig, createOrderStore, orderDefinition } from "./workflow";

const REGISTRY_KEY = "order-dashboard-registry";

function loadRegistry(): OrderEntry[] {
	try {
		const stored = localStorage.getItem(REGISTRY_KEY);
		if (stored) return JSON.parse(stored);
	} catch {
		// corrupt data
	}
	return [];
}

function saveRegistry(entries: OrderEntry[]) {
	localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
}

export interface OrderManager {
	registry: OrderEntry[];
	activeOrderId: string | null;
	activeStore: WorkflowStore<OrderConfig> | null;
	activeLog: TimeTravelState;
	createOrder: () => void;
	selectOrder: (id: string) => void;
	deleteOrder: (id: string) => void;
	timeTravel: (cursor: number) => void;
	undo: () => void;
	redo: () => void;
	updateRegistryEntry: (id: string, updates: Partial<Pick<OrderEntry, "customer" | "state">>) => void;
}

const initialRegistry = loadRegistry();

export function useOrderManager(): OrderManager {
	const [registry, setRegistry] = useState<OrderEntry[]>(initialRegistry);
	const [activeOrderId, setActiveOrderId] = useState<string | null>(
		initialRegistry.length > 0 ? initialRegistry[0].id : null,
	);

	// Per-order stores and logs, keyed by order ID
	const storesRef = useRef<Map<string, WorkflowStore<OrderConfig>>>(new Map());
	const logsRef = useRef<Map<string, TimeTravelState>>(new Map());

	// Force re-render counter (for log/time-travel updates that don't touch React state)
	const [, setTick] = useState(0);
	const rerender = useCallback(() => setTick((t) => t + 1), []);

	const getOrCreateLog = useCallback((orderId: string): TimeTravelState => {
		let log = logsRef.current.get(orderId);
		if (!log) {
			log = { entries: [], cursor: -1 };
			logsRef.current.set(orderId, log);
		}
		return log;
	}, []);

	const getOrCreateStore = useCallback(
		(orderId: string): WorkflowStore<OrderConfig> | null => {
			let store = storesRef.current.get(orderId);
			if (store) return store;

			const persistKey = `order-dashboard-${orderId}`;

			try {
				store = createOrderStore({
					persistKey,
					onLog: (partial) => {
						const log = getOrCreateLog(orderId);

						// If cursor is not at the end, truncate forward entries
						if (log.cursor >= 0 && log.cursor < log.entries.length - 1) {
							log.entries = log.entries.slice(0, log.cursor + 1);
						}

						const entry: LogEntry = {
							...partial,
							id: log.entries.length,
							timestamp: Date.now(),
						};
						log.entries.push(entry);
						log.cursor = log.entries.length - 1;
						rerender();
					},
				});
			} catch {
				// Failed to create store (corrupt persistence) — remove from registry
				setRegistry((prev) => {
					const next = prev.filter((e) => e.id !== orderId);
					saveRegistry(next);
					return next;
				});
				localStorage.removeItem(persistKey);
				return null;
			}

			storesRef.current.set(orderId, store);

			// Add __init__ entry to the log
			const log = getOrCreateLog(orderId);
			if (log.entries.length === 0) {
				const workflow = store.getWorkflow();
				const snapshot = orderDefinition.snapshot(workflow);
				log.entries.push({
					id: 0,
					command: "__init__",
					payload: {},
					fromState: workflow.state as string,
					toState: workflow.state as string,
					timestamp: Date.now(),
					durationMs: 0,
					events: [],
					error: null,
					snapshot,
				});
				log.cursor = 0;
			}

			return store;
		},
		[getOrCreateLog, rerender],
	);

	const createOrder = useCallback(() => {
		const id = crypto.randomUUID();
		const entry: OrderEntry = {
			id,
			customer: "",
			state: "Draft",
			createdAt: new Date().toISOString(),
		};
		setRegistry((prev) => {
			const next = [entry, ...prev];
			saveRegistry(next);
			return next;
		});
		setActiveOrderId(id);
	}, []);

	const selectOrder = useCallback((id: string) => {
		setActiveOrderId(id);
	}, []);

	const deleteOrder = useCallback(
		(id: string) => {
			// Clean up store and log
			storesRef.current.delete(id);
			logsRef.current.delete(id);
			localStorage.removeItem(`order-dashboard-${id}`);

			let nextActiveId: string | null = null;
			setRegistry((prev) => {
				const next = prev.filter((e) => e.id !== id);
				saveRegistry(next);
				nextActiveId = next.length > 0 ? next[0].id : null;
				return next;
			});

			setActiveOrderId((currentId) => {
				if (currentId === id) {
					return nextActiveId;
				}
				return currentId;
			});
		},
		[],
	);

	const timeTravel = useCallback(
		(cursor: number) => {
			if (!activeOrderId) return;
			const log = logsRef.current.get(activeOrderId);
			const store = storesRef.current.get(activeOrderId);
			if (!log || !store) return;

			if (cursor < 0 || cursor >= log.entries.length) return;

			const entry = log.entries[cursor];
			const result = orderDefinition.restore(entry.snapshot);
			if (result.ok) {
				store.setWorkflow(result.workflow);
				log.cursor = cursor;
				rerender();
			}
		},
		[activeOrderId, rerender],
	);

	const undo = useCallback(() => {
		if (!activeOrderId) return;
		const log = logsRef.current.get(activeOrderId);
		if (!log || log.cursor <= 0) return;
		timeTravel(log.cursor - 1);
	}, [activeOrderId, timeTravel]);

	const redo = useCallback(() => {
		if (!activeOrderId) return;
		const log = logsRef.current.get(activeOrderId);
		if (!log || log.cursor >= log.entries.length - 1) return;
		timeTravel(log.cursor + 1);
	}, [activeOrderId, timeTravel]);

	const updateRegistryEntry = useCallback(
		(id: string, updates: Partial<Pick<OrderEntry, "customer" | "state">>) => {
			setRegistry((prev) => {
				const next = prev.map((e) => (e.id === id ? { ...e, ...updates } : e));
				saveRegistry(next);
				return next;
			});
		},
		[],
	);

	// Resolve active store (lazily created via useMemo to avoid state updates during render)
	const activeStore = useMemo(
		() => (activeOrderId ? getOrCreateStore(activeOrderId) : null),
		[activeOrderId, getOrCreateStore],
	);
	const activeLog = activeOrderId
		? (logsRef.current.get(activeOrderId) ?? { entries: [], cursor: -1 })
		: { entries: [], cursor: -1 };

	return {
		registry,
		activeOrderId,
		activeStore,
		activeLog,
		createOrder,
		selectOrder,
		deleteOrder,
		timeTravel,
		undo,
		redo,
		updateRegistryEntry,
	};
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add examples/react-order-dashboard/src/use-order-manager.ts
git commit -m "feat(example): add useOrderManager hook for multi-order + logging + time-travel"
git push
```

---

## Chunk 3: UI Components

### Task 4: Create OrderList component (left sidebar)

**Files:**
- Create: `examples/react-order-dashboard/src/components/OrderList.tsx`

- [ ] **Step 1: Create OrderList**

```tsx
import type { OrderEntry } from "../types";

interface OrderListProps {
	orders: OrderEntry[];
	activeOrderId: string | null;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onDelete: (id: string) => void;
}

export function OrderList({ orders, activeOrderId, onSelect, onCreate, onDelete }: OrderListProps) {
	return (
		<div
			style={{
				width: 220,
				minWidth: 220,
				borderRight: "1px solid #e5e7eb",
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				background: "#fafafa",
			}}
		>
			<div style={{ padding: "16px 12px", borderBottom: "1px solid #e5e7eb" }}>
				<button
					onClick={onCreate}
					style={{
						width: "100%",
						padding: "8px 12px",
						background: "#1976d2",
						color: "#fff",
						border: "none",
						borderRadius: 6,
						fontSize: 14,
						fontWeight: 600,
						cursor: "pointer",
					}}
				>
					+ New Order
				</button>
			</div>

			<div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
				{orders.length === 0 && (
					<div style={{ padding: "24px 12px", textAlign: "center", color: "#999", fontSize: 13 }}>
						No orders yet
					</div>
				)}

				{orders.map((order) => (
					<div
						key={order.id}
						onClick={() => onSelect(order.id)}
						style={{
							padding: "10px 12px",
							margin: "2px 8px",
							borderRadius: 6,
							cursor: "pointer",
							background: order.id === activeOrderId ? "#e3f2fd" : "transparent",
							border: order.id === activeOrderId ? "1px solid #90caf9" : "1px solid transparent",
							position: "relative",
						}}
					>
						<div
							style={{
								fontSize: 13,
								fontWeight: 600,
								color: "#333",
								marginBottom: 4,
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
								paddingRight: 20,
							}}
						>
							{order.customer || "Untitled Order"}
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
							<span
								style={{
									display: "inline-block",
									padding: "1px 6px",
									background: stateColor(order.state),
									color: "#fff",
									borderRadius: 4,
									fontSize: 11,
									fontWeight: 600,
								}}
							>
								{order.state}
							</span>
							<span style={{ fontSize: 11, color: "#999" }}>
								{new Date(order.createdAt).toLocaleDateString()}
							</span>
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								onDelete(order.id);
							}}
							style={{
								position: "absolute",
								top: 8,
								right: 8,
								background: "none",
								border: "none",
								color: "#ccc",
								fontSize: 16,
								cursor: "pointer",
								padding: 0,
								lineHeight: 1,
							}}
							onMouseEnter={(e) => (e.currentTarget.style.color = "#dc2626")}
							onMouseLeave={(e) => (e.currentTarget.style.color = "#ccc")}
						>
							×
						</button>
					</div>
				))}
			</div>
		</div>
	);
}

function stateColor(state: string): string {
	switch (state) {
		case "Draft":
			return "#6b7280";
		case "Submitted":
			return "#2563eb";
		case "Approved":
			return "#16a34a";
		case "Paid":
			return "#7c3aed";
		case "Shipped":
			return "#d97706";
		case "Delivered":
			return "#059669";
		case "Rejected":
			return "#dc2626";
		default:
			return "#6b7280";
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add examples/react-order-dashboard/src/components/OrderList.tsx
git commit -m "feat(example): add OrderList sidebar component"
git push
```

---

### Task 5: Create DevToolsPanel, LogTab, and TimeTravelTab components

**Files:**
- Create: `examples/react-order-dashboard/src/components/DevToolsPanel.tsx`
- Create: `examples/react-order-dashboard/src/components/LogTab.tsx`
- Create: `examples/react-order-dashboard/src/components/TimeTravelTab.tsx`

- [ ] **Step 1: Create LogTab**

```tsx
import { useEffect, useRef } from "react";
import type { LogEntry } from "../types";

interface LogTabProps {
	entries: LogEntry[];
	cursor: number;
}

export function LogTab({ entries, cursor }: LogTabProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [entries.length]);

	return (
		<div style={{ padding: "8px 0" }}>
			{entries.length === 0 && (
				<div style={{ padding: "24px 12px", textAlign: "center", color: "#999", fontSize: 13 }}>
					No dispatches yet
				</div>
			)}

			{entries.map((entry, index) => (
				<div
					key={entry.id}
					style={{
						padding: "6px 12px",
						fontSize: 12,
						borderBottom: "1px solid #f0f0f0",
						opacity: index > cursor ? 0.35 : 1,
						fontFamily: "monospace",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
						<span
							style={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								background: dotColor(entry),
								display: "inline-block",
								flexShrink: 0,
							}}
						/>
						<span style={{ fontWeight: 600, color: "#333" }}>{entry.command}</span>
						{entry.command !== "__init__" && (
							<span style={{ color: "#888" }}>
								{entry.fromState} → {entry.toState}
							</span>
						)}
					</div>

					<div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 14 }}>
						{entry.durationMs > 0 && (
							<span style={{ color: "#aaa", fontSize: 11 }}>{entry.durationMs.toFixed(1)}ms</span>
						)}
						{entry.events.map((evt) => (
							<span
								key={evt}
								style={{
									display: "inline-block",
									padding: "0 4px",
									background: "#e8f4fd",
									color: "#1976d2",
									borderRadius: 3,
									fontSize: 10,
								}}
							>
								{evt}
							</span>
						))}
					</div>

					{entry.error && (
						<div style={{ color: "#dc2626", fontSize: 11, paddingLeft: 14, marginTop: 2 }}>
							[{entry.error.category}] {entry.error.message}
						</div>
					)}
				</div>
			))}
			<div ref={bottomRef} />
		</div>
	);
}

function dotColor(entry: LogEntry): string {
	if (entry.command === "__init__") return "#9ca3af";
	if (entry.error) return "#dc2626";
	return "#16a34a";
}
```

- [ ] **Step 2: Create TimeTravelTab**

```tsx
import type { TimeTravelState } from "../types";

interface TimeTravelTabProps {
	log: TimeTravelState;
	isDispatching: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onJump: (cursor: number) => void;
}

export function TimeTravelTab({ log, isDispatching, onUndo, onRedo, onJump }: TimeTravelTabProps) {
	const { entries, cursor } = log;
	const canUndo = cursor > 0 && !isDispatching;
	const canRedo = cursor < entries.length - 1 && !isDispatching;

	return (
		<div style={{ padding: "12px" }}>
			<div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
				<button
					onClick={onUndo}
					disabled={!canUndo}
					style={{
						flex: 1,
						padding: "6px 12px",
						background: canUndo ? "#1976d2" : "#e5e7eb",
						color: canUndo ? "#fff" : "#999",
						border: "none",
						borderRadius: 4,
						fontSize: 13,
						fontWeight: 600,
						cursor: canUndo ? "pointer" : "default",
					}}
				>
					← Undo
				</button>
				<button
					onClick={onRedo}
					disabled={!canRedo}
					style={{
						flex: 1,
						padding: "6px 12px",
						background: canRedo ? "#1976d2" : "#e5e7eb",
						color: canRedo ? "#fff" : "#999",
						border: "none",
						borderRadius: 4,
						fontSize: 13,
						fontWeight: 600,
						cursor: canRedo ? "pointer" : "default",
					}}
				>
					Redo →
				</button>
			</div>

			<div style={{ position: "relative", paddingLeft: 20 }}>
				{/* Vertical line */}
				<div
					style={{
						position: "absolute",
						left: 7,
						top: 8,
						bottom: 8,
						width: 2,
						background: "#e5e7eb",
					}}
				/>

				{entries.map((entry, index) => {
					const isActive = index === cursor;
					const isFuture = index > cursor;

					return (
						<div
							key={entry.id}
							onClick={() => !isDispatching && onJump(index)}
							style={{
								display: "flex",
								alignItems: "flex-start",
								gap: 10,
								padding: "6px 0",
								cursor: isDispatching ? "default" : "pointer",
								opacity: isFuture ? 0.35 : 1,
							}}
						>
							{/* Dot */}
							<div
								style={{
									width: 14,
									height: 14,
									borderRadius: "50%",
									background: isActive ? "#1976d2" : entry.error ? "#fecaca" : "#d1d5db",
									border: isActive ? "3px solid #90caf9" : "2px solid #fff",
									flexShrink: 0,
									marginTop: 2,
									boxShadow: isActive ? "0 0 0 2px #1976d2" : "none",
									zIndex: 1,
									position: "relative",
								}}
							/>

							{/* Content */}
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 12,
										fontWeight: isActive ? 700 : 500,
										color: isActive ? "#1976d2" : "#333",
										fontFamily: "monospace",
									}}
								>
									{entry.command}
								</div>
								<div style={{ fontSize: 11, color: "#888" }}>
									→ {entry.toState}
									<span style={{ marginLeft: 8, color: "#bbb" }}>
										{new Date(entry.timestamp).toLocaleTimeString()}
									</span>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Create DevToolsPanel**

```tsx
import { useState } from "react";
import type { TimeTravelState } from "../types";
import { LogTab } from "./LogTab";
import { TimeTravelTab } from "./TimeTravelTab";

interface DevToolsPanelProps {
	log: TimeTravelState;
	isDispatching: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onJump: (cursor: number) => void;
}

export function DevToolsPanel({ log, isDispatching, onUndo, onRedo, onJump }: DevToolsPanelProps) {
	const [activeTab, setActiveTab] = useState<"log" | "timetravel">("log");

	return (
		<div
			style={{
				width: 300,
				minWidth: 300,
				borderLeft: "1px solid #e5e7eb",
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				background: "#fafafa",
			}}
		>
			{/* Tab bar */}
			<div
				style={{
					display: "flex",
					borderBottom: "1px solid #e5e7eb",
					background: "#fff",
				}}
			>
				{(["log", "timetravel"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						style={{
							flex: 1,
							padding: "10px 0",
							background: "none",
							border: "none",
							borderBottom: activeTab === tab ? "2px solid #1976d2" : "2px solid transparent",
							color: activeTab === tab ? "#1976d2" : "#666",
							fontSize: 13,
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						{tab === "log" ? `Log (${log.entries.length})` : "Time Travel"}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div style={{ flex: 1, overflowY: "auto" }}>
				{activeTab === "log" ? (
					<LogTab entries={log.entries} cursor={log.cursor} />
				) : (
					<TimeTravelTab
						log={log}
						isDispatching={isDispatching}
						onUndo={onUndo}
						onRedo={onRedo}
						onJump={onJump}
					/>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Verify all compile**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add examples/react-order-dashboard/src/components/DevToolsPanel.tsx examples/react-order-dashboard/src/components/LogTab.tsx examples/react-order-dashboard/src/components/TimeTravelTab.tsx
git commit -m "feat(example): add DevTools panel with log and time-travel tabs"
git push
```

---

## Chunk 4: Dashboard and Wiring

### Task 6: Create Dashboard component and update main.tsx

**Files:**
- Create: `examples/react-order-dashboard/src/Dashboard.tsx`
- Modify: `examples/react-order-dashboard/src/main.tsx`
- Modify: `examples/react-order-dashboard/src/App.tsx`

- [ ] **Step 1: Create Dashboard**

```tsx
import { useEffect, useRef } from "react";
import { App } from "./App";
import { DevToolsPanel } from "./components/DevToolsPanel";
import { OrderList } from "./components/OrderList";
import type { OrderManager } from "./use-order-manager";
import { useOrderManager } from "./use-order-manager";
import { OrderContext } from "./workflow";

export function Dashboard() {
	const manager = useOrderManager();

	return (
		<div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
			{/* Left sidebar */}
			<OrderList
				orders={manager.registry}
				activeOrderId={manager.activeOrderId}
				onSelect={manager.selectOrder}
				onCreate={manager.createOrder}
				onDelete={manager.deleteOrder}
			/>

			{/* Center + Right: single Provider wrapping both */}
			{manager.activeStore ? (
				<OrderContext.Provider store={manager.activeStore}>
					<div style={{ flex: 1, overflowY: "auto" }}>
						<AppWithRegistrySync
							orderId={manager.activeOrderId!}
							onRegistryUpdate={manager.updateRegistryEntry}
						/>
					</div>
					<DevToolsPanelWithDispatching manager={manager} />
				</OrderContext.Provider>
			) : (
				<div
					style={{
						flex: 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "#999",
						fontSize: 16,
					}}
				>
					{manager.registry.length === 0
						? "Create an order to get started"
						: "Select an order"}
				</div>
			)}
		</div>
	);
}

/**
 * Wrapper that syncs workflow state changes back to the order registry
 * for sidebar display (state badge, customer name).
 */
function AppWithRegistrySync({
	orderId,
	onRegistryUpdate,
}: {
	orderId: string;
	onRegistryUpdate: (id: string, updates: { customer?: string; state?: string }) => void;
}) {
	const { state, workflow } = OrderContext.useWorkflow();
	const prevRef = useRef({ state: "", customer: "" });

	useEffect(() => {
		const customer = "customer" in workflow.data ? (workflow.data.customer as string) : "";
		const currentState = state as string;
		if (prevRef.current.state !== currentState || prevRef.current.customer !== customer) {
			prevRef.current = { state: currentState, customer };
			onRegistryUpdate(orderId, { state: currentState, customer });
		}
	}, [state, workflow.data, orderId, onRegistryUpdate]);

	return <App />;
}

/**
 * Wrapper that reads isDispatching from the active store's context.
 */
function DevToolsPanelWithDispatching({ manager }: { manager: OrderManager }) {
	const { isDispatching } = OrderContext.useWorkflow();

	return (
		<DevToolsPanel
			log={manager.activeLog}
			isDispatching={isDispatching}
			onUndo={manager.undo}
			onRedo={manager.redo}
			onJump={manager.timeTravel}
		/>
	);
}
```

- [ ] **Step 2: Update main.tsx**

Replace the entire content of `examples/react-order-dashboard/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed to exist in index.html
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Dashboard />
	</StrictMode>,
);
```

- [ ] **Step 3: Simplify App.tsx**

The `App` component no longer needs to create its own provider or manage the outer chrome. Remove the max-width constraint (the center column handles sizing now). Update `examples/react-order-dashboard/src/App.tsx`:

```tsx
import { ApprovedView } from "./components/ApprovedView";
import { DeliveredView } from "./components/DeliveredView";
import { DraftView } from "./components/DraftView";
import { PaidView } from "./components/PaidView";
import { RejectedView } from "./components/RejectedView";
import { ShippedView } from "./components/ShippedView";
import { StepIndicator } from "./components/StepIndicator";
import { SubmittedView } from "./components/SubmittedView";
import { OrderContext } from "./workflow";

function ItemCountBadge() {
	const itemCount = OrderContext.useWorkflow((w) => w.data.items?.length ?? 0);

	return (
		<span
			data-testid="item-count"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "4px 12px",
				background: "#e8f4fd",
				color: "#1976d2",
				borderRadius: 16,
				fontSize: 14,
				fontWeight: 600,
			}}
		>
			{itemCount} item{itemCount !== 1 ? "s" : ""}
		</span>
	);
}

function ErrorMessage() {
	const { error } = OrderContext.useWorkflow();

	if (!error) return null;

	let message = "An error occurred";
	if (error.category === "domain" && error.code === "EmptyOrder") {
		message = "Cannot submit an empty order. Add at least one item.";
	} else if (error.category === "validation") {
		message = error.message;
	} else if (error.category === "router") {
		message = error.message;
	} else if (error.category === "unexpected") {
		message = error.message;
	}

	return (
		<div
			data-testid="error-message"
			style={{
				padding: "12px 16px",
				background: "#fef2f2",
				border: "1px solid #fca5a5",
				borderRadius: 8,
				color: "#991b1b",
				fontSize: 14,
				marginBottom: 16,
			}}
		>
			{message}
		</div>
	);
}

export function App() {
	const { state, match } = OrderContext.useWorkflow();

	return (
		<div style={{ maxWidth: 700, margin: "40px auto", padding: "0 20px" }}>
			<header style={{ textAlign: "center", marginBottom: 32 }}>
				<h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>Order Dashboard</h1>
				<p style={{ color: "#666", margin: 0, fontSize: 14 }}>
					Powered by <code>@rytejs/react</code>
				</p>
			</header>

			<StepIndicator currentState={state} />

			<div
				style={{
					background: "#fff",
					borderRadius: 12,
					boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
					padding: 24,
					marginTop: 24,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 20,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						<span
							data-testid="current-state"
							style={{
								display: "inline-block",
								padding: "4px 12px",
								background: "#f0f0f0",
								borderRadius: 16,
								fontSize: 14,
								fontWeight: 600,
								color: "#555",
							}}
						>
							{state}
						</span>
						<ItemCountBadge />
					</div>
				</div>

				<ErrorMessage />

				{match({
					Draft: (data) => <DraftView data={data} />,
					Submitted: (data) => <SubmittedView data={data} />,
					Approved: (data) => <ApprovedView data={data} />,
					Paid: (data) => <PaidView data={data} />,
					Shipped: (data) => <ShippedView data={data} />,
					Delivered: (data) => <DeliveredView data={data} />,
					Rejected: (data) => <RejectedView data={data} />,
				})}
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Verify all compile**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add examples/react-order-dashboard/src/Dashboard.tsx examples/react-order-dashboard/src/main.tsx examples/react-order-dashboard/src/App.tsx
git commit -m "feat(example): add Dashboard with 3-column layout"
git push
```

---

## Chunk 5: Verification

### Task 7: Build, run, and validate in browser

- [ ] **Step 1: Build the react package (prerequisite for the example app)**

Run: `cd packages/react && pnpm tsup`
Expected: Build succeeds

- [ ] **Step 2: Install example dependencies**

Run: `cd examples/react-order-dashboard && pnpm install`
Expected: Dependencies resolved

- [ ] **Step 3: Typecheck**

Run: `cd examples/react-order-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Start dev server**

Run: `cd examples/react-order-dashboard && pnpm dev`
Expected: Vite dev server starts at http://localhost:5173

- [ ] **Step 5: Validate with Playwright**

Use the `playwright-cli` skill to open `http://localhost:5173` and verify:

1. App shows empty state: "Create an order to get started"
2. Click "New Order" → order appears in left sidebar with "Draft" badge
3. Center column shows the Draft view with form
4. Right panel shows Log tab with `__init__` entry
5. Add an item (fill name + price, click Add) → log shows `AddItem` entry
6. Set customer name → log shows `SetCustomer` entry
7. Submit order → log shows `Submit` with `Draft → Submitted` transition + `OrderSubmitted` event badge
8. Switch to Time Travel tab → shows timeline with all entries
9. Click Undo → state goes back to Draft (before Submit)
10. Click Redo → state returns to Submitted
11. Click Approve → moves to Approved, log shows transition
12. Create a second order → appears in sidebar
13. Switch between orders → center and devtools update correctly
14. Delete the second order → removed from sidebar
15. Reload page → first order restores from localStorage (Approved state), log resets to `__init__`

- [ ] **Step 6: Fix any issues found during validation**

Address any TypeScript errors, runtime errors, or visual issues discovered during Playwright validation.

- [ ] **Step 7: Final commit**

```bash
git add examples/react-order-dashboard/
git commit -m "feat(example): finalize dashboard with devtools, logging, and time-travel"
git push
```
