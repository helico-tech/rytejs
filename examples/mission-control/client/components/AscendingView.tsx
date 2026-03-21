import type { TelemetryReading } from "../../shared/mission.ts";
import { cn } from "../lib/utils.ts";
import { AltitudeChart } from "./viz/AltitudeChart.tsx";
import { TelemetryGauge } from "./viz/TelemetryGauge.tsx";
import { TrajectoryViz } from "./viz/TrajectoryViz.tsx";

interface AscendingData {
	name: string;
	destination: string;
	crewMembers: string[];
	fuelLevel: number;
	countdownStartedAt: Date;
	telemetryStatus: "go" | "no-go";
	secondsRemaining: number;
	launchedAt: Date;
	altitude: number;
	velocity: number;
	heading: number;
	telemetryReadings: TelemetryReading[];
}

interface AscendingViewProps {
	data: AscendingData;
}

export function AscendingView({ data }: AscendingViewProps) {
	return (
		<div className="max-w-4xl mx-auto space-y-6">
			{/* Header */}
			<div className="flex items-center gap-3">
				<h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">{data.name}</h2>
				<span
					className={cn(
						"text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider",
						"bg-[hsl(var(--cyan))]/15 text-[hsl(var(--cyan))] animate-pulse",
					)}
				>
					Ascending
				</span>
				<span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
					{data.destination}
				</span>
			</div>

			{/* Trajectory visualization */}
			<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
				<TrajectoryViz altitude={data.altitude} />
			</div>

			{/* Telemetry gauges */}
			<div className="grid grid-cols-3 gap-4">
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col items-center">
					<TelemetryGauge value={data.altitude} min={0} max={500} label="Altitude" unit="km" />
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col items-center">
					<TelemetryGauge value={data.velocity} min={0} max={10} label="Velocity" unit="km/s" />
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col items-center">
					<TelemetryGauge value={data.heading} min={0} max={360} label="Heading" unit={"\u00B0"} />
				</div>
			</div>

			{/* Live telemetry readings */}
			<div className="grid grid-cols-3 gap-4">
				<div className="font-mono text-center">
					<span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
						ALT
					</span>
					<div className="text-xl text-[hsl(var(--primary))]">{data.altitude.toFixed(1)} km</div>
				</div>
				<div className="font-mono text-center">
					<span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
						VEL
					</span>
					<div className="text-xl text-[hsl(var(--primary))]">{data.velocity.toFixed(2)} km/s</div>
				</div>
				<div className="font-mono text-center">
					<span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
						HDG
					</span>
					<div className="text-xl text-[hsl(var(--primary))]">{data.heading.toFixed(1)}&deg;</div>
				</div>
			</div>

			{/* Altitude sparkline */}
			{data.telemetryReadings.length > 1 && (
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
						Altitude History
					</div>
					<AltitudeChart readings={data.telemetryReadings} />
				</div>
			)}
		</div>
	);
}
