import { useWorkflow } from "@rytejs/react";
import { useCallback, useMemo, useState } from "react";
import { missionDef } from "../../shared/mission.ts";
import { client } from "../App.tsx";
import { cn } from "../lib/utils.ts";
import { AscendingView } from "./AscendingView.tsx";
import { CountdownView } from "./CountdownView.tsx";
import { PlanningView } from "./PlanningView.tsx";
import { ScrubbedView } from "./ScrubbedView.tsx";
import { AbortView, CancelledView, OrbitAchievedView } from "./TerminalViews.tsx";

interface MissionDetailProps {
	id: string;
	onDeleted?: () => void;
}

export function MissionDetail({ id, onDeleted }: MissionDetailProps) {
	const store = useMemo(() => client.connect(missionDef, id), [id]);
	const wf = useWorkflow(store);
	const [isDeleting, setIsDeleting] = useState(false);

	const handleDelete = useCallback(async () => {
		if (!confirm("Delete this mission? This cannot be undone.")) return;
		setIsDeleting(true);
		try {
			const res = await fetch(`/api/missions/${id}`, { method: "DELETE" });
			if (res.ok) {
				onDeleted?.();
			}
		} finally {
			setIsDeleting(false);
		}
	}, [id, onDeleted]);

	if (wf.isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<div className="w-8 h-8 border-2 border-[hsl(var(--primary))]/30 border-t-[hsl(var(--primary))] rounded-full animate-spin mx-auto mb-3" />
					<div className="text-sm text-[hsl(var(--muted-foreground))]">Loading mission data...</div>
				</div>
			</div>
		);
	}

	if (wf.error) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center text-[hsl(var(--destructive))]">
					<div className="text-sm font-medium mb-1">Error</div>
					<div className="text-xs">
						{(wf.error as { message?: string }).message ?? "Unknown error"}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="p-6">
			<div className="flex justify-end mb-4">
				<button
					type="button"
					onClick={handleDelete}
					disabled={isDeleting}
					className={cn(
						"px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
						"bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]",
						"hover:bg-[hsl(var(--destructive))]/20",
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
				>
					{isDeleting ? "Deleting..." : "Delete Mission"}
				</button>
			</div>
			{wf.match(
				{
					Planning: (data) => (
						<PlanningView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
					),
					Countdown: (data) => (
						<CountdownView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
					),
					Scrubbed: (data) => (
						<ScrubbedView data={data} dispatch={wf.dispatch} isDispatching={wf.isDispatching} />
					),
					Ascending: (data) => <AscendingView data={data} />,
					OrbitAchieved: (data) => <OrbitAchievedView data={data} />,
					AbortSequence: (data) => <AbortView data={data} />,
					Cancelled: (data) => <CancelledView data={data} />,
				},
				() => (
					<div className="text-[hsl(var(--muted-foreground))] text-sm">Unknown mission state</div>
				),
			)}
		</div>
	);
}
