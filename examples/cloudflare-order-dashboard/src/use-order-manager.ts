import type { WorkflowStore } from "@rytejs/react";
import { createWorkflowStore } from "@rytejs/react";
import { composeSyncTransport, httpCommandTransport, wsUpdateTransport } from "@rytejs/sync";
import { useCallback, useMemo, useRef, useState } from "react";
import type { LogEntry, OrderEntry } from "./types.js";
import { clientRouter, type OrderConfig } from "./workflow.js";

// Shared transport — all orders use the same HTTP + WebSocket transport
const transport = composeSyncTransport({
	commands: httpCommandTransport({ url: "/api", router: "order" }),
	updates: wsUpdateTransport({ url: "/api", router: "order" }),
});

export interface OrderManager {
	registry: OrderEntry[];
	activeOrderId: string | null;
	activeStore: WorkflowStore<OrderConfig> | null;
	activeLog: LogEntry[];
	createOrder: () => void;
	selectOrder: (id: string) => void;
	deleteOrder: (id: string) => void;
	updateRegistryEntry: (
		id: string,
		updates: Partial<Pick<OrderEntry, "customer" | "state">>,
	) => void;
}

export function useOrderManager(): OrderManager {
	const [registry, setRegistry] = useState<OrderEntry[]>([]);
	const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
	const [initialized, setInitialized] = useState(false);

	// Per-order stores and logs, keyed by order ID
	const storesRef = useRef<Map<string, WorkflowStore<OrderConfig>>>(new Map());
	const logsRef = useRef<Map<string, LogEntry[]>>(new Map());

	// Force re-render counter (for log updates that don't touch React state)
	const [, setTick] = useState(0);
	const rerender = useCallback(() => setTick((t) => t + 1), []);

	// Fetch registry from server on first render
	if (!initialized) {
		setInitialized(true);
		fetch("/api/orders")
			.then((r) => r.json())
			.then((orders: Array<{ id: string; createdAt: string }>) => {
				const entries: OrderEntry[] = orders.map((o) => ({
					id: o.id,
					customer: "",
					state: "Draft",
					createdAt: o.createdAt,
				}));
				setRegistry(entries);
				if (entries.length > 0 && entries[0]) {
					setActiveOrderId(entries[0].id);
				}
			})
			.catch(() => {
				// Server not ready yet
			});
	}

	const getOrCreateLog = useCallback((orderId: string): LogEntry[] => {
		let log = logsRef.current.get(orderId);
		if (!log) {
			log = [];
			logsRef.current.set(orderId, log);
		}
		return log;
	}, []);

	const getOrCreateStore = useCallback(
		(orderId: string): WorkflowStore<OrderConfig> | null => {
			let store = storesRef.current.get(orderId);
			if (store) return store;

			store = createWorkflowStore(
				clientRouter,
				{
					state: "Draft" as const,
					data: { customer: "", items: [] },
					id: orderId,
				},
				{ sync: transport },
			);

			const log = getOrCreateLog(orderId);
			const originalDispatch = store.dispatch;

			// Wrap dispatch to capture log entries
			const wrappedDispatch: typeof originalDispatch = async (command, payload, options) => {
				const beforeWorkflow = store!.getWorkflow();
				const fromState = beforeWorkflow.state;
				const start = performance.now();

				const result = await originalDispatch(command, payload, options);

				const durationMs = performance.now() - start;
				const afterWorkflow = result.ok ? result.workflow : store!.getWorkflow();

				const entry: LogEntry = {
					id: log.length,
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
					timestamp: Date.now(),
				};
				log.push(entry);
				rerender();

				return result;
			};

			const wrappedStore: WorkflowStore<OrderConfig> = {
				...store,
				dispatch: wrappedDispatch,
			};

			storesRef.current.set(orderId, wrappedStore);
			return wrappedStore;
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

		// Create on server
		fetch(`/api/order/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ initialState: "Draft", data: { customer: "", items: [] } }),
		}).catch(() => {
			// Server creation failed — will be retried on next dispatch
		});

		setRegistry((prev) => [entry, ...prev]);
		setActiveOrderId(id);
	}, []);

	const selectOrder = useCallback((id: string) => {
		setActiveOrderId(id);
	}, []);

	const deleteOrder = useCallback((id: string) => {
		// Clean up store and log
		const store = storesRef.current.get(id);
		if (store) store.cleanup();
		storesRef.current.delete(id);
		logsRef.current.delete(id);

		// Delete on server
		fetch(`/api/order/${id}`, { method: "DELETE" }).catch(() => {});

		let nextActiveId: string | null = null;
		setRegistry((prev) => {
			const next = prev.filter((e) => e.id !== id);
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

	const updateRegistryEntry = useCallback(
		(id: string, updates: Partial<Pick<OrderEntry, "customer" | "state">>) => {
			setRegistry((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
		},
		[],
	);

	// Resolve active store
	const activeStore = useMemo(
		() => (activeOrderId ? getOrCreateStore(activeOrderId) : null),
		[activeOrderId, getOrCreateStore],
	);
	const activeLog = activeOrderId ? (logsRef.current.get(activeOrderId) ?? []) : [];

	return {
		registry,
		activeOrderId,
		activeStore,
		activeLog,
		createOrder,
		selectOrder,
		deleteOrder,
		updateRegistryEntry,
	};
}
