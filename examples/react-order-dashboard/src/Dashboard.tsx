import { useEffect, useRef } from "react";
import { App } from "./App.js";
import { DevToolsPanel } from "./components/DevToolsPanel.js";
import { OrderList } from "./components/OrderList.js";
import type { OrderManager } from "./use-order-manager.js";
import { useOrderManager } from "./use-order-manager.js";
import { OrderContext } from "./workflow.js";

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
					{manager.registry.length === 0 ? "Create an order to get started" : "Select an order"}
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
