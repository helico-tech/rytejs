import type { CommandNames, CommandPayload, DispatchResult } from "@rytejs/core";
import { useState } from "react";
import type { MissionConfig } from "../../shared/mission.ts";
import { cn } from "../lib/utils.ts";

interface PlanningData {
	name: string;
	destination: string;
	crewMembers: string[];
	fuelLevel: number;
}

interface PlanningViewProps {
	data: PlanningData;
	dispatch: <C extends CommandNames<MissionConfig>>(
		command: C,
		payload: CommandPayload<MissionConfig, C>,
	) => Promise<DispatchResult<MissionConfig>>;
	isDispatching: boolean;
}

export function PlanningView({ data, dispatch, isDispatching }: PlanningViewProps) {
	const [showCancel, setShowCancel] = useState(false);
	const [cancelReason, setCancelReason] = useState("");

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<div className="flex items-center gap-3 mb-6">
				<h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">{data.name}</h2>
				<span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--cyan))]/15 text-[hsl(var(--cyan))]">
					Planning
				</span>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Destination
					</div>
					<div className="text-lg font-medium text-[hsl(var(--foreground))]">
						{data.destination}
					</div>
				</div>

				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Fuel Level
					</div>
					<div className="flex items-center gap-3">
						<div className="flex-1 h-2 rounded-full bg-[hsl(var(--secondary))]">
							<div
								className={cn(
									"h-full rounded-full transition-all",
									data.fuelLevel > 50
										? "bg-[hsl(var(--success))]"
										: data.fuelLevel > 20
											? "bg-[hsl(var(--warning))]"
											: "bg-[hsl(var(--destructive))]",
								)}
								style={{ width: `${data.fuelLevel}%` }}
							/>
						</div>
						<span className="text-sm font-mono text-[hsl(var(--foreground))]">
							{data.fuelLevel}%
						</span>
					</div>
				</div>
			</div>

			<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
				<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
					Crew Members
				</div>
				<div className="flex flex-wrap gap-2">
					{data.crewMembers.map((member) => (
						<span
							key={member}
							className="px-3 py-1.5 text-sm rounded-md bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]"
						>
							{member}
						</span>
					))}
				</div>
			</div>

			<div className="flex gap-3 pt-4">
				<button
					type="button"
					onClick={() => dispatch("InitiateCountdown", {})}
					disabled={isDispatching}
					className={cn(
						"flex-1 px-4 py-3 text-sm font-semibold rounded-lg transition-all",
						"bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
						"hover:opacity-90 disabled:opacity-50",
					)}
				>
					{isDispatching ? "Initiating..." : "Initiate Countdown"}
				</button>

				{!showCancel ? (
					<button
						type="button"
						onClick={() => setShowCancel(true)}
						className={cn(
							"px-4 py-3 text-sm font-medium rounded-lg transition-colors",
							"border border-[hsl(var(--destructive))]/50 text-[hsl(var(--destructive))]",
							"hover:bg-[hsl(var(--destructive))]/10",
						)}
					>
						Cancel Mission
					</button>
				) : (
					<div className="flex gap-2">
						<input
							type="text"
							value={cancelReason}
							onChange={(e) => setCancelReason(e.target.value)}
							placeholder="Reason..."
							className={cn(
								"px-3 py-2 text-sm rounded-md w-48",
								"bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]",
								"text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]",
								"focus:outline-none focus:ring-1 focus:ring-[hsl(var(--destructive))]",
							)}
						/>
						<button
							type="button"
							onClick={() => {
								if (cancelReason.trim()) {
									dispatch("CancelMission", { reason: cancelReason.trim() });
								}
							}}
							disabled={isDispatching || !cancelReason.trim()}
							className={cn(
								"px-4 py-2 text-sm font-medium rounded-lg transition-colors",
								"bg-[hsl(var(--destructive))] text-white",
								"hover:opacity-90 disabled:opacity-50",
							)}
						>
							Confirm
						</button>
						<button
							type="button"
							onClick={() => {
								setShowCancel(false);
								setCancelReason("");
							}}
							className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
						>
							Back
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
