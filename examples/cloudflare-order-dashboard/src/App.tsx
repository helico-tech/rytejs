import { ApprovedView } from "./components/ApprovedView";
import { DeliveredView } from "./components/DeliveredView";
import { DraftView } from "./components/DraftView";
import { PaidView } from "./components/PaidView";
import { RejectedView } from "./components/RejectedView";
import { ShippedView } from "./components/ShippedView";
import { StepIndicator } from "./components/StepIndicator";
import { SubmittedView } from "./components/SubmittedView";
import { OrderContext } from "./workflow";

function ItemCountBadge() {
	const itemCount = OrderContext.useWorkflow((w) => w.data.items?.length ?? 0);

	return (
		<span
			data-testid="item-count"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "4px 12px",
				background: "#e8f4fd",
				color: "#1976d2",
				borderRadius: 16,
				fontSize: 14,
				fontWeight: 600,
			}}
		>
			{itemCount} item{itemCount !== 1 ? "s" : ""}
		</span>
	);
}

function ErrorMessage() {
	const { error } = OrderContext.useWorkflow();

	if (!error) return null;

	let message = "An error occurred";
	if (error.category === "domain" && error.code === "EmptyOrder") {
		message = "Cannot submit an empty order. Add at least one item.";
	} else if (error.category === "validation") {
		message = error.message;
	} else if (error.category === "router") {
		message = error.message;
	} else if (error.category === "unexpected") {
		message = error.message;
	}

	return (
		<div
			data-testid="error-message"
			style={{
				padding: "12px 16px",
				background: "#fef2f2",
				border: "1px solid #fca5a5",
				borderRadius: 8,
				color: "#991b1b",
				fontSize: 14,
				marginBottom: 16,
			}}
		>
			{message}
		</div>
	);
}

export function App() {
	const { state, match } = OrderContext.useWorkflow();

	return (
		<div
			style={{
				maxWidth: 700,
				margin: "40px auto",
				padding: "0 20px",
			}}
		>
			<header
				style={{
					textAlign: "center",
					marginBottom: 32,
				}}
			>
				<h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>Order Dashboard</h1>
				<p style={{ color: "#666", margin: 0, fontSize: 14 }}>
					Powered by <code>@rytejs/react</code>
				</p>
			</header>

			<StepIndicator currentState={state} />

			<div
				style={{
					background: "#fff",
					borderRadius: 12,
					boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
					padding: 24,
					marginTop: 24,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 20,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						<span
							data-testid="current-state"
							style={{
								display: "inline-block",
								padding: "4px 12px",
								background: "#f0f0f0",
								borderRadius: 16,
								fontSize: 14,
								fontWeight: 600,
								color: "#555",
							}}
						>
							{state}
						</span>
						<ItemCountBadge />
					</div>
				</div>

				<ErrorMessage />

				{match({
					Draft: (data) => <DraftView data={data} />,
					Submitted: (data) => <SubmittedView data={data} />,
					Approved: (data) => <ApprovedView data={data} />,
					Paid: (data) => <PaidView data={data} />,
					Shipped: (data) => <ShippedView data={data} />,
					Delivered: (data) => <DeliveredView data={data} />,
					Rejected: (data) => <RejectedView data={data} />,
				})}
			</div>
		</div>
	);
}
