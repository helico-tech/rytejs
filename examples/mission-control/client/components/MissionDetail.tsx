import { useWorkflow } from "@rytejs/react";
import { useMemo } from "react";
import { missionDef } from "../../shared/mission.ts";
import { client } from "../App.tsx";
import { AscendingView } from "./AscendingView.tsx";
import { CountdownView } from "./CountdownView.tsx";
import { PlanningView } from "./PlanningView.tsx";
import { ScrubbedView } from "./ScrubbedView.tsx";
import { AbortView, CancelledView, OrbitAchievedView } from "./TerminalViews.tsx";

interface MissionDetailProps {
	id: string;
}

export function MissionDetail({ id }: MissionDetailProps) {
	const store = useMemo(() => client.connect(missionDef, id), [id]);
	const wf = useWorkflow(store);

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
					<div className="text-xs">{wf.error.message}</div>
				</div>
			</div>
		);
	}

	return (
		<div className="p-6">
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
