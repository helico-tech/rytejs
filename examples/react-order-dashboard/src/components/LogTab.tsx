import { useEffect, useRef } from "react";
import type { LogEntry } from "../types.js";

interface LogTabProps {
	entries: LogEntry[];
	cursor: number;
}

export function LogTab({ entries, cursor }: LogTabProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom when new entries are added
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [entries.length]);

	return (
		<div style={{ padding: "8px 0" }}>
			{entries.length === 0 && (
				<div style={{ padding: "24px 12px", textAlign: "center", color: "#999", fontSize: 13 }}>
					No dispatches yet
				</div>
			)}

			{entries.map((entry, index) => (
				<div
					key={entry.id}
					style={{
						padding: "6px 12px",
						fontSize: 12,
						borderBottom: "1px solid #f0f0f0",
						opacity: index > cursor ? 0.35 : 1,
						fontFamily: "monospace",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
						<span
							style={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								background: dotColor(entry),
								display: "inline-block",
								flexShrink: 0,
							}}
						/>
						<span style={{ fontWeight: 600, color: "#333" }}>{entry.command}</span>
						{entry.command !== "__init__" && (
							<span style={{ color: "#888" }}>
								{entry.fromState} → {entry.toState}
							</span>
						)}
					</div>

					<div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 14 }}>
						{entry.durationMs > 0 && (
							<span style={{ color: "#aaa", fontSize: 11 }}>{entry.durationMs.toFixed(1)}ms</span>
						)}
						{entry.events.map((evt) => (
							<span
								key={evt}
								style={{
									display: "inline-block",
									padding: "0 4px",
									background: "#e8f4fd",
									color: "#1976d2",
									borderRadius: 3,
									fontSize: 10,
								}}
							>
								{evt}
							</span>
						))}
					</div>

					{entry.error && (
						<div style={{ color: "#dc2626", fontSize: 11, paddingLeft: 14, marginTop: 2 }}>
							[{entry.error.category}] {entry.error.message}
						</div>
					)}
				</div>
			))}
			<div ref={bottomRef} />
		</div>
	);
}

function dotColor(entry: LogEntry): string {
	if (entry.command === "__init__") return "#9ca3af";
	if (entry.error) return "#dc2626";
	return "#16a34a";
}
