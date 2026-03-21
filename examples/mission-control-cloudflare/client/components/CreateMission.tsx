import { type FormEvent, useState } from "react";
import { cn } from "../lib/utils.ts";

interface CreateMissionProps {
	onCreated: (id: string) => void;
}

export function CreateMission({ onCreated }: CreateMissionProps) {
	const [name, setName] = useState("");
	const [destination, setDestination] = useState("");
	const [crew, setCrew] = useState("");
	const [fuelLevel, setFuelLevel] = useState(95);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setIsSubmitting(true);

		const id = crypto.randomUUID();
		const crewMembers = crew
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		try {
			const res = await fetch(`/api/missions/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, destination, crewMembers, fuelLevel }),
			});

			if (res.ok) {
				onCreated(id);
			} else {
				setError("Failed to create mission");
			}
		} catch {
			setError("Network error");
		} finally {
			setIsSubmitting(false);
		}
	}

	const inputClass = cn(
		"w-full px-3 py-2 text-sm rounded-md",
		"bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]",
		"text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]",
		"focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]",
	);

	return (
		<form onSubmit={handleSubmit} className="p-4 space-y-3">
			<label className="block">
				<span className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
					Mission Name
				</span>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Artemis VII"
					required
					className={inputClass}
				/>
			</label>
			<label className="block">
				<span className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
					Destination
				</span>
				<input
					type="text"
					value={destination}
					onChange={(e) => setDestination(e.target.value)}
					placeholder="Mars orbit"
					required
					className={inputClass}
				/>
			</label>
			<label className="block">
				<span className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
					Crew Members
				</span>
				<input
					type="text"
					value={crew}
					onChange={(e) => setCrew(e.target.value)}
					placeholder="Chen, Kowalski, Nakamura"
					required
					className={inputClass}
				/>
				<span className="text-[10px] text-[hsl(var(--muted-foreground))]">Comma-separated</span>
			</label>
			<label className="block">
				<span className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
					Fuel Level: {fuelLevel}%
				</span>
				<input
					type="range"
					min={0}
					max={100}
					value={fuelLevel}
					onChange={(e) => setFuelLevel(Number(e.target.value))}
					className="w-full accent-[hsl(var(--primary))]"
				/>
			</label>

			{error && <div className="text-xs text-[hsl(var(--destructive))]">{error}</div>}

			<button
				type="submit"
				disabled={isSubmitting}
				className={cn(
					"w-full px-3 py-2 text-sm font-medium rounded-md transition-colors",
					"bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
					"hover:opacity-90 disabled:opacity-50",
				)}
			>
				{isSubmitting ? "Creating..." : "Create Mission"}
			</button>
		</form>
	);
}
