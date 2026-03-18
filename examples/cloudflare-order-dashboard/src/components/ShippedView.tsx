import type { Item } from "../workflow";
import { OrderContext } from "../workflow";
import { OrderSummary } from "./OrderSummary";

interface ShippedViewProps {
	data: { customer: string; items: Item[]; trackingNumber: string; shippedAt: Date };
}

export function ShippedView({ data }: ShippedViewProps) {
	const { dispatch, isDispatching } = OrderContext.useWorkflow();

	return (
		<div>
			<div
				style={{
					marginBottom: 16,
					padding: "8px 12px",
					background: "#faf5ff",
					borderRadius: 6,
					fontSize: 13,
					color: "#6b21a8",
				}}
			>
				Shipped on {data.shippedAt.toLocaleString()} — Tracking:{" "}
				<code style={{ background: "#f3e8ff", padding: "1px 4px", borderRadius: 3 }}>
					{data.trackingNumber}
				</code>
			</div>

			<OrderSummary customer={data.customer} items={data.items} />

			<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
				<button
					data-testid="btn-deliver"
					type="button"
					onClick={() => dispatch("ConfirmDelivery", {})}
					disabled={isDispatching}
					style={{
						padding: "10px 20px",
						borderRadius: 6,
						border: "none",
						fontWeight: 600,
						fontSize: 14,
						cursor: "pointer",
						background: "#16a34a",
						color: "#fff",
						opacity: isDispatching ? 0.5 : 1,
						transition: "opacity 0.2s",
					}}
				>
					{isDispatching ? "Confirming..." : "Confirm Delivery"}
				</button>
			</div>
		</div>
	);
}
