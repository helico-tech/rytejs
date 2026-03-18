import type { Item } from "../workflow";
import { OrderSummary } from "./OrderSummary";

interface DeliveredViewProps {
	data: { customer: string; items: Item[]; deliveredAt: Date };
}

export function DeliveredView({ data }: DeliveredViewProps) {
	return (
		<div>
			<div
				style={{
					marginBottom: 16,
					padding: "12px 16px",
					background: "#f0fdf4",
					borderRadius: 8,
					textAlign: "center",
				}}
			>
				<div style={{ fontSize: 24, marginBottom: 4 }}>Order Complete</div>
				<div style={{ fontSize: 13, color: "#166534" }}>
					Delivered on {data.deliveredAt.toLocaleString()}
				</div>
			</div>

			<OrderSummary customer={data.customer} items={data.items} />
		</div>
	);
}
