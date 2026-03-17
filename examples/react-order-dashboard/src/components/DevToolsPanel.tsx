import { useState } from "react";
import type { TimeTravelState } from "../types.js";
import { LogTab } from "./LogTab.js";
import { TimeTravelTab } from "./TimeTravelTab.js";

interface DevToolsPanelProps {
	log: TimeTravelState;
	isDispatching: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onJump: (cursor: number) => void;
}

export function DevToolsPanel({ log, isDispatching, onUndo, onRedo, onJump }: DevToolsPanelProps) {
	const [activeTab, setActiveTab] = useState<"log" | "timetravel">("log");

	return (
		<div
			style={{
				width: 300,
				minWidth: 300,
				borderLeft: "1px solid #e5e7eb",
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				background: "#fafafa",
			}}
		>
			{/* Tab bar */}
			<div
				style={{
					display: "flex",
					borderBottom: "1px solid #e5e7eb",
					background: "#fff",
				}}
			>
				{(["log", "timetravel"] as const).map((tab) => (
					<button
						type="button"
						key={tab}
						onClick={() => setActiveTab(tab)}
						style={{
							flex: 1,
							padding: "10px 0",
							background: "none",
							border: "none",
							borderBottom: activeTab === tab ? "2px solid #1976d2" : "2px solid transparent",
							color: activeTab === tab ? "#1976d2" : "#666",
							fontSize: 13,
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						{tab === "log" ? `Log (${log.entries.length})` : "Time Travel"}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div style={{ flex: 1, overflowY: "auto" }}>
				{activeTab === "log" ? (
					<LogTab entries={log.entries} cursor={log.cursor} />
				) : (
					<TimeTravelTab
						log={log}
						isDispatching={isDispatching}
						onUndo={onUndo}
						onRedo={onRedo}
						onJump={onJump}
					/>
				)}
			</div>
		</div>
	);
}
