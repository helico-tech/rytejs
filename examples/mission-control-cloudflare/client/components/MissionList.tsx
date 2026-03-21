import type { WorkflowSnapshot } from "@rytejs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { CreateMission } from "./CreateMission.tsx";

interface MissionListItem {
	id: string;
	snapshot: WorkflowSnapshot;
	version: number;
}

interface MissionListProps {
	selectedId: string | null;
	onSelect: (id: string) => void;
}

const stateBadgeClass: Record<string, string> = {
	Planning: "bg-[hsl(var(--cyan))]/15 text-[hsl(var(--cyan))]",
	Countdown: "bg-[hsl(var(--cyan))]/15 text-[hsl(var(--cyan))]",
	Ascending: "bg-[hsl(var(--cyan))]/15 text-[hsl(var(--cyan))]",
	OrbitAchieved: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]",
	Scrubbed: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]",
	AbortSequence: "bg-[hsl(var(--destructive))]/15 text-[hsl(var(--destructive))]",
	Cancelled: "bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]",
};

export function MissionList({ selectedId, onSelect }: MissionListProps) {
	const [missions, setMissions] = useState<MissionListItem[]>([]);
	const [showCreate, setShowCreate] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);

	const fetchMissions = useCallback(async () => {
		try {
			const res = await fetch("/api/missions");
			if (res.ok) {
				const data = (await res.json()) as MissionListItem[];
				setMissions(data);
			}
		} catch {
			// Network error — will retry via WebSocket reconnect
		}
	}, []);

	// Initial fetch
	useEffect(() => {
		fetchMissions();
	}, [fetchMissions]);

	// WebSocket subscription for live updates
	useEffect(() => {
		function connect() {
			const protocol = location.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(`${protocol}//${location.host}/api/missions/ws`);
			wsRef.current = ws;

			ws.onmessage = (e) => {
				const msg = JSON.parse(e.data) as {
					type: "init" | "update";
					missions: MissionListItem[];
				};
				if (msg.type === "init" || msg.type === "update") {
					setMissions(msg.missions);
				}
			};

			ws.onclose = () => {
				// Reconnect after a short delay
				setTimeout(connect, 2000);
			};

			ws.onerror = () => {
				ws.close();
			};
		}

		connect();

		return () => {
			const ws = wsRef.current;
			if (ws) {
				wsRef.current = null;
				ws.onclose = null;
				ws.close();
			}
		};
	}, []);

	return (
		<div className="flex flex-col h-full">
			<div className="p-4 border-b border-[hsl(var(--border))]">
				<div className="flex items-center justify-between mb-3">
					<h1 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
						Missions
					</h1>
					<span className="text-xs text-[hsl(var(--muted-foreground))]">{missions.length}</span>
				</div>
				<button
					type="button"
					onClick={() => setShowCreate(!showCreate)}
					className={cn(
						"w-full px-3 py-2 text-sm font-medium rounded-md transition-colors",
						"bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
						"hover:opacity-90",
					)}
				>
					{showCreate ? "Cancel" : "+ New Mission"}
				</button>
			</div>

			{showCreate && (
				<div className="border-b border-[hsl(var(--border))]">
					<CreateMission
						onCreated={(id) => {
							setShowCreate(false);
							onSelect(id);
							// The WebSocket will push the updated list automatically
						}}
					/>
				</div>
			)}

			<div className="flex-1 overflow-y-auto p-2 space-y-1">
				{missions.map((mission) => (
					<button
						key={mission.id}
						type="button"
						onClick={() => onSelect(mission.id)}
						className={cn(
							"w-full text-left px-3 py-3 rounded-lg transition-all",
							"hover:bg-[hsl(var(--secondary))]",
							selectedId === mission.id
								? "bg-[hsl(var(--secondary))] border border-[hsl(var(--primary))]/50"
								: "border border-transparent",
						)}
					>
						<div className="flex items-center justify-between mb-1">
							<span className="font-medium text-sm text-[hsl(var(--foreground))]">
								{(mission.snapshot.data as Record<string, unknown>).name as string}
							</span>
							<span
								className={cn(
									"text-[10px] font-medium px-2 py-0.5 rounded-full",
									stateBadgeClass[mission.snapshot.state] ??
										"bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]",
								)}
							>
								{mission.snapshot.state}
							</span>
						</div>
						<div className="text-xs text-[hsl(var(--muted-foreground))]">
							{(mission.snapshot.data as Record<string, unknown>).destination as string}
						</div>
					</button>
				))}
				{missions.length === 0 && (
					<div className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
						No missions yet
					</div>
				)}
			</div>
		</div>
	);
}
