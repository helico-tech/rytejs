import type { OrderEntry } from "../types.js";

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
					type="button"
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
						style={{
							position: "relative",
							margin: "2px 8px",
						}}
					>
						<button
							type="button"
							onClick={() => onSelect(order.id)}
							style={{
								display: "block",
								width: "100%",
								textAlign: "left",
								padding: "10px 12px",
								borderRadius: 6,
								cursor: "pointer",
								background: order.id === activeOrderId ? "#e3f2fd" : "transparent",
								border: order.id === activeOrderId ? "1px solid #90caf9" : "1px solid transparent",
								font: "inherit",
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
						</button>
						<button
							type="button"
							onClick={() => onDelete(order.id)}
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
