import { cn } from "../lib/utils.ts";
import { TrajectoryViz } from "./viz/TrajectoryViz.tsx";

interface ArchivedData {
	previousState: "OrbitAchieved" | "AbortSequence" | "Cancelled";
	name: string;
	destination: string;
	crewMembers: string[];
	// OrbitAchieved fields
	fuelLevel?: number;
	launchedAt?: Date;
	altitude?: number;
	velocity?: number;
	heading?: number;
	orbitAchievedAt?: Date;
	finalAltitude?: number;
	// AbortSequence fields
	abortedAt?: Date;
	reason?: string;
	lastKnownAltitude?: number;
	// Cancelled fields
	cancelledAt?: Date;
}

interface ArchivedViewProps {
	data: ArchivedData;
	// biome-ignore lint/suspicious/noExplicitAny: accepts wf.dispatch which has generic signature
	dispatch: (...args: any[]) => Promise<any>;
	isDispatching: boolean;
}

function previousStateLabel(state: ArchivedData["previousState"]): string {
	switch (state) {
		case "OrbitAchieved":
			return "Orbit Achieved";
		case "AbortSequence":
			return "Abort Sequence";
		case "Cancelled":
			return "Cancelled";
	}
}

function OrbitAchievedContent({ data }: { data: ArchivedData }) {
	const launchedAt =
		data.launchedAt instanceof Date
			? data.launchedAt
			: new Date(data.launchedAt as unknown as string);
	const orbitAt =
		data.orbitAchievedAt instanceof Date
			? data.orbitAchievedAt
			: new Date(data.orbitAchievedAt as unknown as string);
	const durationMs = orbitAt.getTime() - launchedAt.getTime();
	const durationMin = Math.floor(durationMs / 60000);
	const durationSec = Math.floor((durationMs % 60000) / 1000);

	return (
		<>
			{/* Trajectory */}
			<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 opacity-75">
				<TrajectoryViz altitude={data.finalAltitude ?? 0} />
			</div>

			{/* Stats grid */}
			<div className="grid grid-cols-2 gap-4 opacity-75">
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Final Altitude
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--muted-foreground))]">
						{(data.finalAltitude ?? 0).toFixed(1)} km
					</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Final Velocity
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--muted-foreground))]">
						{(data.velocity ?? 0).toFixed(2)} km/s
					</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Flight Duration
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--muted-foreground))]">
						{durationMin}m {durationSec}s
					</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Destination
					</div>
					<div className="text-2xl font-medium text-[hsl(var(--muted-foreground))]">
						{data.destination}
					</div>
				</div>
			</div>
		</>
	);
}

function AbortSequenceContent({ data }: { data: ArchivedData }) {
	return (
		<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4 opacity-75">
			<div>
				<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
					Abort Reason
				</div>
				<div className="text-lg text-[hsl(var(--muted-foreground))]">{data.reason}</div>
			</div>

			<div className="flex gap-8">
				<div>
					<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Last Known Altitude
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--muted-foreground))]">
						{(data.lastKnownAltitude ?? 0).toFixed(1)} km
					</div>
				</div>
				<div>
					<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Destination
					</div>
					<div className="text-lg text-[hsl(var(--muted-foreground))]">{data.destination}</div>
				</div>
			</div>
		</div>
	);
}

function CancelledContent({ data }: { data: ArchivedData }) {
	return (
		<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4 opacity-75">
			<div>
				<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
					Cancellation Reason
				</div>
				<div className="text-lg text-[hsl(var(--muted-foreground))]">{data.reason}</div>
			</div>

			<div>
				<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
					Destination
				</div>
				<div className="text-sm text-[hsl(var(--muted-foreground))]">{data.destination}</div>
			</div>
		</div>
	);
}

export function ArchivedView({ data, dispatch, isDispatching }: ArchivedViewProps) {
	return (
		<div className="max-w-3xl mx-auto space-y-6">
			{/* Archived banner */}
			<div className="rounded-lg border border-[hsl(var(--muted-foreground))]/20 bg-[hsl(var(--muted))]/10 p-6 text-center">
				<div className="text-2xl font-bold text-[hsl(var(--muted-foreground))] tracking-wider mb-2">
					ARCHIVED
				</div>
				<div className="text-sm text-[hsl(var(--muted-foreground))]/70">
					{data.name} — previously {previousStateLabel(data.previousState)}
				</div>
			</div>

			{/* Content based on previousState */}
			{data.previousState === "OrbitAchieved" && <OrbitAchievedContent data={data} />}
			{data.previousState === "AbortSequence" && <AbortSequenceContent data={data} />}
			{data.previousState === "Cancelled" && <CancelledContent data={data} />}

			{/* Unarchive button */}
			<div className="flex justify-center pt-2">
				<button
					type="button"
					onClick={() => dispatch("Unarchive", {})}
					disabled={isDispatching}
					className={cn(
						"px-6 py-3 text-sm font-medium rounded-lg transition-colors",
						"border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
						"hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]",
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
				>
					{isDispatching ? "Unarchiving..." : "Unarchive Mission"}
				</button>
			</div>

			{/* Crew */}
			<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 opacity-75">
				<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
					Crew
				</div>
				<div className="flex flex-wrap gap-2">
					{data.crewMembers.map((member) => (
						<span
							key={member}
							className="px-3 py-1.5 text-sm rounded-md bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]"
						>
							{member}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}
