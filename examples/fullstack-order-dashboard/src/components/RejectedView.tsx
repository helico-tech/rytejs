import type { Item } from "../workflow";
import { OrderContext } from "../workflow";
import { OrderSummary } from "./OrderSummary";

interface RejectedViewProps {
	data: { customer: string; items: Item[]; reason: string; rejectedAt: Date };
}

export function RejectedView({ data }: RejectedViewProps) {
	const { dispatch, isDispatching } = OrderContext.useWorkflow();

	return (
		<div>
			<div
				style={{
					marginBottom: 16,
					padding: "12px 16px",
					background: "#fef2f2",
					border: "1px solid #fca5a5",
					borderRadius: 8,
				}}
			>
				<div style={{ fontWeight: 600, color: "#991b1b", marginBottom: 4 }}>Order Rejected</div>
				<div style={{ fontSize: 13, color: "#b91c1c" }}>
					Rejected on {data.rejectedAt.toLocaleString()}
				</div>
				<div style={{ marginTop: 8, fontSize: 14, color: "#7f1d1d" }}>
					<strong>Reason:</strong> {data.reason}
				</div>
			</div>

			<OrderSummary customer={data.customer} items={data.items} />

			<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
				<button
					data-testid="btn-resubmit"
					type="button"
					onClick={() => dispatch("Resubmit", {})}
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
					{isDispatching ? "Resubmitting..." : "Resubmit Order"}
				</button>
			</div>
		</div>
	);
}
