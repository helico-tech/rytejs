import type { CommandNames, CommandPayload, DispatchResult } from "@rytejs/core";
import { useState } from "react";
import type { MissionConfig } from "../../shared/mission.ts";
import { cn } from "../lib/utils.ts";

interface CountdownData {
	name: string;
	destination: string;
	crewMembers: string[];
	fuelLevel: number;
	countdownStartedAt: Date;
	telemetryStatus: "go" | "no-go";
	secondsRemaining: number;
}

interface CountdownViewProps {
	data: CountdownData;
	dispatch: <C extends CommandNames<MissionConfig>>(
		command: C,
		payload: CommandPayload<MissionConfig, C>,
	) => Promise<DispatchResult<MissionConfig>>;
	isDispatching: boolean;
}

export function CountdownView({ data, dispatch, isDispatching }: CountdownViewProps) {
	const [showScrub, setShowScrub] = useState(false);
	const [scrubReason, setScrubReason] = useState("");

	const isLaunching = data.secondsRemaining <= 0;

	return (
		<div className="max-w-2xl mx-auto text-center space-y-8">
			<div className="flex items-center justify-center gap-3">
				<h2 className="text-xl font-semibold text-[hsl(var(--foreground))]">{data.name}</h2>
				<span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--cyan))]/15 text-[hsl(var(--cyan))] animate-pulse">
					Countdown
				</span>
			</div>

			{/* Large countdown display */}
			<div className="py-8">
				{isLaunching ? (
					<div className="font-mono text-6xl font-bold text-[hsl(var(--primary))] animate-pulse">
						LAUNCHING...
					</div>
				) : (
					<div className="font-mono text-8xl font-bold text-[hsl(var(--foreground))] tabular-nums">
						T-{data.secondsRemaining}
					</div>
				)}
			</div>

			{/* GO / NO-GO badge */}
			<div className="flex justify-center">
				{data.telemetryStatus === "go" ? (
					<div
						className={cn(
							"px-8 py-3 rounded-lg text-lg font-bold uppercase tracking-widest",
							"bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]",
							"border border-[hsl(var(--success))]/30",
						)}
					>
						GO
					</div>
				) : (
					<div
						className={cn(
							"px-8 py-3 rounded-lg text-lg font-bold uppercase tracking-widest",
							"bg-[hsl(var(--destructive))]/15 text-[hsl(var(--destructive))]",
							"border border-[hsl(var(--destructive))]/30",
						)}
					>
						NO-GO
					</div>
				)}
			</div>

			{/* Mission info */}
			<div className="grid grid-cols-3 gap-4">
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Destination
					</div>
					<div className="text-sm text-[hsl(var(--foreground))]">{data.destination}</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Fuel
					</div>
					<div className="text-sm font-mono text-[hsl(var(--foreground))]">{data.fuelLevel}%</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Crew
					</div>
					<div className="text-sm text-[hsl(var(--foreground))]">
						{data.crewMembers.length} members
					</div>
				</div>
			</div>

			{/* Scrub controls */}
			{!isLaunching && (
				<div className="pt-4">
					{!showScrub ? (
						<button
							type="button"
							onClick={() => setShowScrub(true)}
							className={cn(
								"px-6 py-3 text-sm font-semibold rounded-lg transition-colors",
								"border border-[hsl(var(--warning))]/50 text-[hsl(var(--warning))]",
								"hover:bg-[hsl(var(--warning))]/10",
							)}
						>
							SCRUB
						</button>
					) : (
						<div className="flex items-center justify-center gap-3">
							<input
								type="text"
								value={scrubReason}
								onChange={(e) => setScrubReason(e.target.value)}
								placeholder="Scrub reason..."
								className={cn(
									"px-3 py-2 text-sm rounded-md w-64",
									"bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]",
									"text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]",
									"focus:outline-none focus:ring-1 focus:ring-[hsl(var(--warning))]",
								)}
							/>
							<button
								type="button"
								onClick={() => {
									if (scrubReason.trim()) {
										dispatch("ScrubLaunch", { reason: scrubReason.trim() });
									}
								}}
								disabled={isDispatching || !scrubReason.trim()}
								className={cn(
									"px-4 py-2 text-sm font-semibold rounded-lg transition-colors",
									"bg-[hsl(var(--warning))] text-[hsl(var(--primary-foreground))]",
									"hover:opacity-90 disabled:opacity-50",
								)}
							>
								Confirm Scrub
							</button>
							<button
								type="button"
								onClick={() => {
									setShowScrub(false);
									setScrubReason("");
								}}
								className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
							>
								Cancel
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
