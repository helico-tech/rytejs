import { useState } from "react";
import type { Item } from "../workflow";
import { OrderContext } from "../workflow";
import { OrderSummary } from "./OrderSummary";

interface SubmittedViewProps {
	data: { customer: string; items: Item[]; submittedAt: Date };
}

const buttonBase: React.CSSProperties = {
	padding: "10px 20px",
	borderRadius: 6,
	border: "none",
	fontWeight: 600,
	fontSize: 14,
	cursor: "pointer",
	transition: "opacity 0.2s",
};

export function SubmittedView({ data }: SubmittedViewProps) {
	const { dispatch, isDispatching } = OrderContext.useWorkflow();
	const [rejectReason, setRejectReason] = useState("");
	const [showRejectInput, setShowRejectInput] = useState(false);

	return (
		<div>
			<div style={{ marginBottom: 16, fontSize: 13, color: "#888" }}>
				Submitted on {data.submittedAt.toLocaleString()}
			</div>

			<OrderSummary customer={data.customer} items={data.items} />

			<div
				style={{
					display: "flex",
					justifyContent: "flex-end",
					gap: 8,
					marginTop: 20,
					flexWrap: "wrap",
					alignItems: "center",
				}}
			>
				{showRejectInput ? (
					<>
						<input
							type="text"
							value={rejectReason}
							onChange={(e) => setRejectReason(e.target.value)}
							placeholder="Reason for rejection..."
							style={{
								flex: 1,
								minWidth: 200,
								padding: "8px 12px",
								border: "1px solid #ddd",
								borderRadius: 6,
								fontSize: 14,
								outline: "none",
							}}
						/>
						<button
							data-testid="btn-reject"
							type="button"
							onClick={() => {
								if (rejectReason.trim()) {
									dispatch("Reject", { reason: rejectReason.trim() });
								}
							}}
							disabled={isDispatching || !rejectReason.trim()}
							style={{
								...buttonBase,
								background: "#dc2626",
								color: "#fff",
								opacity: isDispatching || !rejectReason.trim() ? 0.5 : 1,
							}}
						>
							Confirm Reject
						</button>
						<button
							type="button"
							onClick={() => {
								setShowRejectInput(false);
								setRejectReason("");
							}}
							style={{
								...buttonBase,
								background: "#f5f5f5",
								color: "#666",
							}}
						>
							Cancel
						</button>
					</>
				) : (
					<>
						<button
							type="button"
							onClick={() => setShowRejectInput(true)}
							style={{
								...buttonBase,
								background: "#fef2f2",
								color: "#dc2626",
								border: "1px solid #fca5a5",
							}}
						>
							Reject
						</button>
						<button
							data-testid="btn-approve"
							type="button"
							onClick={() => dispatch("Approve", { approvedBy: "Dashboard Admin" })}
							disabled={isDispatching}
							style={{
								...buttonBase,
								background: "#16a34a",
								color: "#fff",
								opacity: isDispatching ? 0.5 : 1,
							}}
						>
							{isDispatching ? "Approving..." : "Approve"}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
