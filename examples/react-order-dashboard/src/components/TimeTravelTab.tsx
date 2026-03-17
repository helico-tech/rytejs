import type { TimeTravelState } from "../types.js";

interface TimeTravelTabProps {
	log: TimeTravelState;
	isDispatching: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onJump: (cursor: number) => void;
}

export function TimeTravelTab({ log, isDispatching, onUndo, onRedo, onJump }: TimeTravelTabProps) {
	const { entries, cursor } = log;
	const canUndo = cursor > 0 && !isDispatching;
	const canRedo = cursor < entries.length - 1 && !isDispatching;

	return (
		<div style={{ padding: "12px" }}>
			<div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
				<button
					type="button"
					onClick={onUndo}
					disabled={!canUndo}
					style={{
						flex: 1,
						padding: "6px 12px",
						background: canUndo ? "#1976d2" : "#e5e7eb",
						color: canUndo ? "#fff" : "#999",
						border: "none",
						borderRadius: 4,
						fontSize: 13,
						fontWeight: 600,
						cursor: canUndo ? "pointer" : "default",
					}}
				>
					← Undo
				</button>
				<button
					type="button"
					onClick={onRedo}
					disabled={!canRedo}
					style={{
						flex: 1,
						padding: "6px 12px",
						background: canRedo ? "#1976d2" : "#e5e7eb",
						color: canRedo ? "#fff" : "#999",
						border: "none",
						borderRadius: 4,
						fontSize: 13,
						fontWeight: 600,
						cursor: canRedo ? "pointer" : "default",
					}}
				>
					Redo →
				</button>
			</div>

			<div style={{ position: "relative", paddingLeft: 20 }}>
				{/* Vertical line */}
				<div
					style={{
						position: "absolute",
						left: 7,
						top: 8,
						bottom: 8,
						width: 2,
						background: "#e5e7eb",
					}}
				/>

				{entries.map((entry, index) => {
					const isActive = index === cursor;
					const isFuture = index > cursor;

					return (
						<button
							type="button"
							key={entry.id}
							onClick={() => !isDispatching && onJump(index)}
							disabled={isDispatching}
							style={{
								display: "flex",
								alignItems: "flex-start",
								gap: 10,
								padding: "6px 0",
								cursor: isDispatching ? "default" : "pointer",
								opacity: isFuture ? 0.35 : 1,
								background: "none",
								border: "none",
								width: "100%",
								textAlign: "left",
								font: "inherit",
							}}
						>
							{/* Dot */}
							<div
								style={{
									width: 14,
									height: 14,
									borderRadius: "50%",
									background: isActive ? "#1976d2" : entry.error ? "#fecaca" : "#d1d5db",
									border: isActive ? "3px solid #90caf9" : "2px solid #fff",
									flexShrink: 0,
									marginTop: 2,
									boxShadow: isActive ? "0 0 0 2px #1976d2" : "none",
									zIndex: 1,
									position: "relative",
								}}
							/>

							{/* Content */}
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 12,
										fontWeight: isActive ? 700 : 500,
										color: isActive ? "#1976d2" : "#333",
										fontFamily: "monospace",
									}}
								>
									{entry.command}
								</div>
								<div style={{ fontSize: 11, color: "#888" }}>
									→ {entry.toState}
									<span style={{ marginLeft: 8, color: "#bbb" }}>
										{new Date(entry.timestamp).toLocaleTimeString()}
									</span>
								</div>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
