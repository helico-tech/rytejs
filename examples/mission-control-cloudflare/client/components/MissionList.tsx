import type { WorkflowSnapshot } from "@rytejs/core";
import { useCallback, useEffect, useState } from "react";
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

const STORAGE_KEY = "mission-control:missions";

function loadMissionIds(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

function saveMissionIds(ids: string[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function addMissionId(id: string): void {
	const ids = loadMissionIds();
	if (!ids.includes(id)) {
		saveMissionIds([id, ...ids]);
	}
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

	const fetchMissions = useCallback(async () => {
		const ids = loadMissionIds();
		const results: MissionListItem[] = [];

		for (const id of ids) {
			try {
				const res = await fetch(`/api/missions/${id}`);
				if (res.ok) {
					const data = (await res.json()) as { snapshot: WorkflowSnapshot; version: number };
					results.push({ id, snapshot: data.snapshot, version: data.version });
				}
			} catch {
				// Mission may have been deleted or is unreachable
			}
		}

		setMissions(results);
	}, []);

	useEffect(() => {
		fetchMissions();
	}, [fetchMissions]);

	// Poll for updates every 5 seconds (DOs don't support listing natively)
	useEffect(() => {
		const interval = setInterval(fetchMissions, 5000);
		return () => clearInterval(interval);
	}, [fetchMissions]);

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
							addMissionId(id);
							setShowCreate(false);
							onSelect(id);
							fetchMissions();
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
