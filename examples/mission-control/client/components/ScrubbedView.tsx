import type { CommandNames, CommandPayload, DispatchResult } from "@rytejs/core";
import type { MissionConfig } from "../../shared/mission.ts";
import { cn } from "../lib/utils.ts";

interface ScrubbedData {
	name: string;
	destination: string;
	crewMembers: string[];
	fuelLevel: number;
	scrubbedAt: Date;
	reason: string;
	attemptNumber: number;
}

interface ScrubbedViewProps {
	data: ScrubbedData;
	dispatch: <C extends CommandNames<MissionConfig>>(
		command: C,
		payload: CommandPayload<MissionConfig, C>,
	) => Promise<DispatchResult<MissionConfig>>;
	isDispatching: boolean;
}

export function ScrubbedView({ data, dispatch, isDispatching }: ScrubbedViewProps) {
	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<div className="flex items-center gap-3">
				<h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">{data.name}</h2>
				<span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]">
					Scrubbed
				</span>
			</div>

			<div className="rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--card))] p-6 space-y-4">
				<div>
					<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Scrub Reason
					</div>
					<div className="text-lg text-[hsl(var(--warning))]">{data.reason}</div>
				</div>

				<div className="flex gap-8">
					<div>
						<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
							Attempt
						</div>
						<div className="text-2xl font-mono text-[hsl(var(--foreground))]">
							#{data.attemptNumber}
						</div>
					</div>
					<div>
						<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
							Fuel Level
						</div>
						<div className="text-2xl font-mono text-[hsl(var(--foreground))]">
							{data.fuelLevel}%
						</div>
					</div>
					<div>
						<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
							Crew
						</div>
						<div className="text-2xl font-mono text-[hsl(var(--foreground))]">
							{data.crewMembers.length}
						</div>
					</div>
				</div>
			</div>

			<button
				type="button"
				onClick={() => dispatch("RetryCountdown", {})}
				disabled={isDispatching}
				className={cn(
					"w-full px-4 py-3 text-sm font-semibold rounded-lg transition-all",
					"bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
					"hover:opacity-90 disabled:opacity-50",
				)}
			>
				{isDispatching ? "Retrying..." : "Retry Countdown"}
			</button>
		</div>
	);
}
