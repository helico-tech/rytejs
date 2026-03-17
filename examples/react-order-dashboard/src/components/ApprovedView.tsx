import type { Item } from "../workflow";
import { OrderContext } from "../workflow";
import { OrderSummary } from "./OrderSummary";

interface ApprovedViewProps {
	data: { customer: string; items: Item[]; approvedBy: string };
}

export function ApprovedView({ data }: ApprovedViewProps) {
	const { dispatch, isDispatching } = OrderContext.useWorkflow();
	const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

	return (
		<div>
			<div
				style={{
					marginBottom: 16,
					padding: "8px 12px",
					background: "#f0fdf4",
					borderRadius: 6,
					fontSize: 13,
					color: "#166534",
				}}
			>
				Approved by <strong>{data.approvedBy}</strong>
			</div>

			<OrderSummary customer={data.customer} items={data.items} />

			<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
				<button
					data-testid="btn-pay"
					type="button"
					onClick={() =>
						dispatch("ProcessPayment", {
							transactionId: `txn_${Date.now()}`,
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
						background: "#1976d2",
						color: "#fff",
						opacity: isDispatching ? 0.5 : 1,
						transition: "opacity 0.2s",
					}}
				>
					{isDispatching ? "Processing..." : `Pay $${total.toFixed(2)}`}
				</button>
			</div>
		</div>
	);
}
