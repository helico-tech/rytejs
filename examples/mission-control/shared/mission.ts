import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

const TelemetryReadingSchema = z.object({
	timestamp: z.string(),
	altitude: z.number(),
	velocity: z.number(),
	heading: z.number(),
});

export type TelemetryReading = z.infer<typeof TelemetryReadingSchema>;

export const missionDef = defineWorkflow("mission", {
	states: {
		Planning: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
		}),
		Countdown: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			countdownStartedAt: z.coerce.date(),
			telemetryStatus: z.enum(["go", "no-go"]),
		}),
		Scrubbed: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			scrubbedAt: z.coerce.date(),
			reason: z.string(),
			attemptNumber: z.number(),
		}),
		Ascending: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			countdownStartedAt: z.coerce.date(),
			telemetryStatus: z.enum(["go", "no-go"]),
			launchedAt: z.coerce.date(),
			altitude: z.number(),
			velocity: z.number(),
			heading: z.number(),
			telemetryReadings: z.array(TelemetryReadingSchema),
		}),
		OrbitAchieved: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			fuelLevel: z.number(),
			launchedAt: z.coerce.date(),
			altitude: z.number(),
			velocity: z.number(),
			heading: z.number(),
			telemetryReadings: z.array(TelemetryReadingSchema),
			orbitAchievedAt: z.coerce.date(),
			finalAltitude: z.number(),
		}),
		AbortSequence: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			abortedAt: z.coerce.date(),
			reason: z.string(),
			lastKnownAltitude: z.number(),
		}),
		Cancelled: z.object({
			name: z.string(),
			destination: z.string(),
			crewMembers: z.array(z.string()),
			cancelledAt: z.coerce.date(),
			reason: z.string(),
		}),
	},
	commands: {
		InitiateCountdown: z.object({}),
		ScrubLaunch: z.object({ reason: z.string() }),
		RetryCountdown: z.object({}),
		Launch: z.object({}),
		UpdateTelemetry: z.object({
			altitude: z.number(),
			velocity: z.number(),
			heading: z.number(),
		}),
		AchieveOrbit: z.object({}),
		TriggerAbort: z.object({ reason: z.string() }),
		CancelMission: z.object({ reason: z.string() }),
	},
	events: {
		CountdownStarted: z.object({ missionId: z.string() }),
		LaunchScrubbed: z.object({ missionId: z.string(), reason: z.string() }),
		Launched: z.object({ missionId: z.string() }),
		TelemetryUpdated: z.object({ missionId: z.string(), altitude: z.number() }),
		OrbitAchieved: z.object({ missionId: z.string(), altitude: z.number() }),
		MissionAborted: z.object({ missionId: z.string(), reason: z.string() }),
		MissionCancelled: z.object({ missionId: z.string(), reason: z.string() }),
	},
	errors: {
		LaunchWindowClosed: z.object({}),
	},
});

export type MissionConfig = typeof missionDef.config;
