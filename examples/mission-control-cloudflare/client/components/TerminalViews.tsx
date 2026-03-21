import { useCallback, useState } from "react";
import type { TelemetryReading } from "../../shared/mission.ts";
import { cn } from "../lib/utils.ts";
import { TrajectoryViz } from "./viz/TrajectoryViz.tsx";

// -- OrbitAchieved --

interface OrbitAchievedData {
	name: string;
	destination: string;
	crewMembers: string[];
	fuelLevel: number;
	launchedAt: Date;
	altitude: number;
	velocity: number;
	heading: number;
	telemetryReadings: TelemetryReading[];
	orbitAchievedAt: Date;
	finalAltitude: number;
}

interface OrbitAchievedViewProps {
	data: OrbitAchievedData;
	// biome-ignore lint/suspicious/noExplicitAny: accepts wf.dispatch which has generic signature
	dispatch: (...args: any[]) => Promise<any>;
	isDispatching: boolean;
	onArchived?: () => void;
}

export function OrbitAchievedView({
	data,
	dispatch,
	isDispatching,
	onArchived,
}: OrbitAchievedViewProps) {
	const [isArchiving, setIsArchiving] = useState(false);
	const launchedAt = data.launchedAt instanceof Date ? data.launchedAt : new Date(data.launchedAt);
	const orbitAt =
		data.orbitAchievedAt instanceof Date ? data.orbitAchievedAt : new Date(data.orbitAchievedAt);
	const durationMs = orbitAt.getTime() - launchedAt.getTime();
	const durationMin = Math.floor(durationMs / 60000);
	const durationSec = Math.floor((durationMs % 60000) / 1000);

	const handleArchive = useCallback(async () => {
		setIsArchiving(true);
		try {
			await dispatch("Archive", {});
			onArchived?.();
		} finally {
			setIsArchiving(false);
		}
	}, [dispatch, onArchived]);

	return (
		<div className="max-w-3xl mx-auto space-y-6">
			{/* Banner */}
			<div className="rounded-lg border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-6 text-center">
				<div className="text-4xl font-bold text-[hsl(var(--success))] tracking-wider mb-2">
					ORBIT ACHIEVED
				</div>
				<div className="text-sm text-[hsl(var(--muted-foreground))]">
					{data.name} has successfully reached orbit
				</div>
			</div>

			{/* Trajectory at orbit */}
			<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
				<TrajectoryViz altitude={data.finalAltitude} />
			</div>

			{/* Stats grid */}
			<div className="grid grid-cols-2 gap-4">
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Final Altitude
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--success))]">
						{data.finalAltitude.toFixed(1)} km
					</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Final Velocity
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--success))]">
						{data.velocity.toFixed(2)} km/s
					</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Flight Duration
					</div>
					<div className="text-2xl font-mono text-[hsl(var(--foreground))]">
						{durationMin}m {durationSec}s
					</div>
				</div>
				<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
					<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Destination
					</div>
					<div className="text-2xl font-medium text-[hsl(var(--foreground))]">
						{data.destination}
					</div>
				</div>
			</div>

			{/* Archive button */}
			<div className="flex justify-center">
				<button
					type="button"
					onClick={handleArchive}
					disabled={isDispatching || isArchiving}
					className={cn(
						"px-4 py-2 text-sm font-medium rounded-lg transition-colors",
						"border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
						"hover:bg-[hsl(var(--secondary))]",
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
				>
					{isArchiving ? "Archiving..." : "Archive Mission"}
				</button>
			</div>

			{/* Crew */}
			<div className="rounded-lg border border-[hsl(var(--success))]/20 bg-[hsl(var(--card))] p-4">
				<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
					Crew
				</div>
				<div className="flex flex-wrap gap-2">
					{data.crewMembers.map((member) => (
						<span
							key={member}
							className="px-3 py-1.5 text-sm rounded-md bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border border-[hsl(var(--success))]/20"
						>
							{member}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

// -- AbortSequence --

interface AbortData {
	name: string;
	destination: string;
	crewMembers: string[];
	abortedAt: Date;
	reason: string;
	lastKnownAltitude: number;
}

interface AbortViewProps {
	data: AbortData;
	// biome-ignore lint/suspicious/noExplicitAny: accepts wf.dispatch which has generic signature
	dispatch: (...args: any[]) => Promise<any>;
	isDispatching: boolean;
	onArchived?: () => void;
}

export function AbortView({ data, dispatch, isDispatching, onArchived }: AbortViewProps) {
	const [isArchiving, setIsArchiving] = useState(false);

	const handleArchive = useCallback(async () => {
		setIsArchiving(true);
		try {
			await dispatch("Archive", {});
			onArchived?.();
		} finally {
			setIsArchiving(false);
		}
	}, [dispatch, onArchived]);

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			{/* Alert banner */}
			<div className="rounded-lg border-2 border-[hsl(var(--destructive))]/50 bg-[hsl(var(--destructive))]/5 p-6 text-center animate-pulse">
				<div className="text-3xl font-bold text-[hsl(var(--destructive))] tracking-wider mb-2">
					ABORT SEQUENCE
				</div>
				<div className="text-sm text-[hsl(var(--muted-foreground))]">
					{data.name} - Mission aborted
				</div>
			</div>

			<div className="rounded-lg border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--card))] p-6 space-y-4">
				<div>
					<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
						Abort Reason
					</div>
					<div className="text-lg text-[hsl(var(--destructive))]">{data.reason}</div>
				</div>

				<div className="flex gap-8">
					<div>
						<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
							Last Known Altitude
						</div>
						<div className="text-2xl font-mono text-[hsl(var(--foreground))]">
							{data.lastKnownAltitude.toFixed(1)} km
						</div>
					</div>
					<div>
						<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">
							Destination
						</div>
						<div className="text-lg text-[hsl(var(--foreground))]">{data.destination}</div>
					</div>
				</div>
			</div>

			{/* Archive button */}
			<div className="flex justify-center">
				<button
					type="button"
					onClick={handleArchive}
					disabled={isDispatching || isArchiving}
					className={cn(
						"px-4 py-2 text-sm font-medium rounded-lg transition-colors",
						"border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
						"hover:bg-[hsl(var(--secondary))]",
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
				>
					{isArchiving ? "Archiving..." : "Archive Mission"}
				</button>
			</div>

			{/* Crew */}
			<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
				<div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
					Crew
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
		</div>
	);
}

// -- Cancelled --

interface CancelledData {
	name: string;
	destination: string;
	crewMembers: string[];
	cancelledAt: Date;
	reason: string;
}

interface CancelledViewProps {
	data: CancelledData;
	// biome-ignore lint/suspicious/noExplicitAny: accepts wf.dispatch which has generic signature
	dispatch: (...args: any[]) => Promise<any>;
	isDispatching: boolean;
	onArchived?: () => void;
}

export function CancelledView({ data, dispatch, isDispatching, onArchived }: CancelledViewProps) {
	const [isArchiving, setIsArchiving] = useState(false);

	const handleArchive = useCallback(async () => {
		setIsArchiving(true);
		try {
			await dispatch("Archive", {});
			onArchived?.();
		} finally {
			setIsArchiving(false);
		}
	}, [dispatch, onArchived]);

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<div className="flex items-center gap-3">
				<h2 className="text-2xl font-semibold text-[hsl(var(--muted-foreground))]">{data.name}</h2>
				<span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]">
					Cancelled
				</span>
			</div>

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

			{/* Archive button */}
			<div className="flex justify-center">
				<button
					type="button"
					onClick={handleArchive}
					disabled={isDispatching || isArchiving}
					className={cn(
						"px-4 py-2 text-sm font-medium rounded-lg transition-colors",
						"border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
						"hover:bg-[hsl(var(--secondary))]",
						"disabled:opacity-50 disabled:cursor-not-allowed",
					)}
				>
					{isArchiving ? "Archiving..." : "Archive Mission"}
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
