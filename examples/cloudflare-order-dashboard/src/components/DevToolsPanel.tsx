import type { LogEntry } from "../types.js";
import { LogTab } from "./LogTab.js";

export function DevToolsPanel({ log, isDispatching }: { log: LogEntry[]; isDispatching: boolean }) {
	return (
		<div
			style={{
				width: 340,
				borderLeft: "1px solid #e5e7eb",
				background: "#fff",
				display: "flex",
				flexDirection: "column",
				overflowY: "auto",
			}}
		>
			<div
				style={{
					padding: "12px 16px",
					borderBottom: "1px solid #e5e7eb",
					display: "flex",
					alignItems: "center",
					gap: 8,
				}}
			>
				<span style={{ fontWeight: 600, fontSize: 14 }}>Dev Tools</span>
				{isDispatching && (
					<span
						style={{
							display: "inline-block",
							width: 8,
							height: 8,
							borderRadius: "50%",
							background: "#f59e0b",
							animation: "pulse 1s infinite",
						}}
					/>
				)}
				<span
					style={{
						marginLeft: "auto",
						fontSize: 12,
						color: "#999",
						padding: "2px 8px",
						background: "#f3f4f6",
						borderRadius: 10,
					}}
				>
					Log ({log.length})
				</span>
			</div>
			<LogTab entries={log} cursor={log.length - 1} />
		</div>
	);
}
