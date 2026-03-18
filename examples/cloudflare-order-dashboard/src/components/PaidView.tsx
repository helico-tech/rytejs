import type { Item } from "../workflow";
import { OrderContext } from "../workflow";
import { OrderSummary } from "./OrderSummary";

interface PaidViewProps {
	data: { customer: string; items: Item[]; paidAt: Date; transactionId: string };
}

export function PaidView({ data }: PaidViewProps) {
	const { dispatch, isDispatching } = OrderContext.useWorkflow();

	return (
		<div>
			<div
				style={{
					marginBottom: 16,
					padding: "8px 12px",
					background: "#eff6ff",
					borderRadius: 6,
					fontSize: 13,
					color: "#1e40af",
				}}
			>
				Payment received on {data.paidAt.toLocaleString()} — Transaction:{" "}
				<code style={{ background: "#dbeafe", padding: "1px 4px", borderRadius: 3 }}>
					{data.transactionId}
				</code>
			</div>

			<OrderSummary customer={data.customer} items={data.items} />

			<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
				<button
					data-testid="btn-ship"
					type="button"
					onClick={() =>
						dispatch("Ship", {
							trackingNumber: `TRK${Date.now().toString(36).toUpperCase()}`,
						})
					}
					disabled={isDispatching}
					style={{
						padding: "10px 20px",
						borderRadius: 6,
						border: "none",
						fontWeight: 600,
						fontSize: 14,
						cursor: "pointer",
						background: "#7c3aed",
						color: "#fff",
						opacity: isDispatching ? 0.5 : 1,
						transition: "opacity 0.2s",
					}}
				>
					{isDispatching ? "Shipping..." : "Ship Order"}
				</button>
			</div>
		</div>
	);
}
