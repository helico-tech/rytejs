const MAIN_STEPS = ["Draft", "Submitted", "Approved", "Paid", "Shipped", "Delivered"] as const;

const stepIndex: Record<string, number> = {
	Draft: 0,
	Submitted: 1,
	Approved: 2,
	Paid: 3,
	Shipped: 4,
	Delivered: 5,
	Rejected: -1,
};

interface StepIndicatorProps {
	currentState: string;
}

export function StepIndicator({ currentState }: StepIndicatorProps) {
	const currentIdx = stepIndex[currentState] ?? -1;
	const isRejected = currentState === "Rejected";

	return (
		<div
			style={{
				background: "#fff",
				borderRadius: 12,
				boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
				padding: "20px 24px",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					position: "relative",
				}}
			>
				{/* Progress line behind dots */}
				<div
					style={{
						position: "absolute",
						top: 16,
						left: 16,
						right: 16,
						height: 3,
						background: "#e0e0e0",
						zIndex: 0,
					}}
				/>
				{!isRejected && currentIdx > 0 && (
					<div
						style={{
							position: "absolute",
							top: 16,
							left: 16,
							width: `${(currentIdx / (MAIN_STEPS.length - 1)) * 100}%`,
							height: 3,
							background: currentIdx === MAIN_STEPS.length - 1 ? "#4caf50" : "#1976d2",
							zIndex: 1,
							transition: "width 0.3s ease",
						}}
					/>
				)}

				{MAIN_STEPS.map((step, idx) => {
					let bgColor: string;
					let textColor: string;
					let borderColor: string;

					if (isRejected) {
						bgColor = "#fff";
						textColor = "#bbb";
						borderColor = "#e0e0e0";
					} else if (idx < currentIdx) {
						// completed
						bgColor = "#4caf50";
						textColor = "#fff";
						borderColor = "#4caf50";
					} else if (idx === currentIdx) {
						// current
						bgColor = "#1976d2";
						textColor = "#fff";
						borderColor = "#1976d2";
					} else {
						// future
						bgColor = "#fff";
						textColor = "#bbb";
						borderColor = "#e0e0e0";
					}

					return (
						<div
							key={step}
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								position: "relative",
								zIndex: 2,
								flex: 1,
							}}
						>
							<div
								style={{
									width: 32,
									height: 32,
									borderRadius: "50%",
									background: bgColor,
									border: `2px solid ${borderColor}`,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: 12,
									fontWeight: 700,
									color: textColor,
									transition: "all 0.3s ease",
								}}
							>
								{!isRejected && idx < currentIdx ? "\u2713" : idx + 1}
							</div>
							<span
								style={{
									marginTop: 6,
									fontSize: 11,
									fontWeight: idx === currentIdx && !isRejected ? 700 : 500,
									color: idx === currentIdx && !isRejected ? "#1976d2" : "#888",
									transition: "all 0.3s ease",
								}}
							>
								{step}
							</span>
						</div>
					);
				})}
			</div>

			{isRejected && (
				<div
					style={{
						marginTop: 12,
						textAlign: "center",
						padding: "8px 16px",
						background: "#fef2f2",
						borderRadius: 8,
						color: "#dc2626",
						fontWeight: 600,
						fontSize: 13,
					}}
				>
					Order Rejected
				</div>
			)}
		</div>
	);
}
