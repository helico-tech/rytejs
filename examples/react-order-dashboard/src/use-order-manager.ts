import type { WorkflowStore } from "@rytejs/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { LogEntry, OrderEntry, TimeTravelState } from "./types.js";
import { createOrderStore, type OrderConfig, orderDefinition } from "./workflow.js";

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
	updateRegistryEntry: (
		id: string,
		updates: Partial<Pick<OrderEntry, "customer" | "state">>,
	) => void;
}

const initialRegistry = loadRegistry();

export function useOrderManager(): OrderManager {
	const [registry, setRegistry] = useState<OrderEntry[]>(initialRegistry);
	const [activeOrderId, setActiveOrderId] = useState<string | null>(
		initialRegistry.length > 0 ? (initialRegistry[0]?.id ?? null) : null,
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

	const deleteOrder = useCallback((id: string) => {
		// Clean up store and log
		storesRef.current.delete(id);
		logsRef.current.delete(id);
		localStorage.removeItem(`order-dashboard-${id}`);

		let nextActiveId: string | null = null;
		setRegistry((prev) => {
			const next = prev.filter((e) => e.id !== id);
			saveRegistry(next);
			nextActiveId = next.length > 0 ? (next[0]?.id ?? null) : null;
			return next;
		});

		setActiveOrderId((currentId) => {
			if (currentId === id) {
				return nextActiveId;
			}
			return currentId;
		});
	}, []);

	const timeTravel = useCallback(
		(cursor: number) => {
			if (!activeOrderId) return;
			const log = logsRef.current.get(activeOrderId);
			const store = storesRef.current.get(activeOrderId);
			if (!log || !store) return;

			if (cursor < 0 || cursor >= log.entries.length) return;

			const entry = log.entries[cursor];
			if (!entry) return;
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
