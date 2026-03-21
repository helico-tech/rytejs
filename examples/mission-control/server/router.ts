import { WorkflowRouter } from "@rytejs/core";
import { missionDef } from "../shared/mission.ts";
import type { TelemetryService } from "./telemetry.ts";

interface MissionDeps {
	telemetry: TelemetryService;
}

export function createMissionRouter(deps: MissionDeps) {
	const router = new WorkflowRouter(missionDef, deps);

	router.state("Planning", ({ on }) => {
		on("InitiateCountdown", async ({ data, deps, error, transition, emit, workflow }) => {
			const result = await deps.telemetry.validateLaunchWindow(
				data.fuelLevel,
				data.crewMembers.length,
			);
			if (!result.go) {
				error({ code: "LaunchWindowClosed", data: {} });
			}
			transition("Countdown", {
				...data,
				countdownStartedAt: new Date(),
				telemetryStatus: "go",
			});
			emit({
				type: "CountdownStarted",
				data: { missionId: workflow.id },
			});
		});

		on("CancelMission", ({ data, command, transition, emit, workflow }) => {
			transition("Cancelled", {
				name: data.name,
				destination: data.destination,
				crewMembers: data.crewMembers,
				cancelledAt: new Date(),
				reason: command.payload.reason,
			});
			emit({
				type: "MissionCancelled",
				data: { missionId: workflow.id, reason: command.payload.reason },
			});
		});
	});

	router.state("Countdown", ({ on }) => {
		on("Launch", ({ data, transition, emit, workflow }) => {
			transition("Ascending", {
				...data,
				launchedAt: new Date(),
				altitude: 0,
				velocity: 0,
				heading: 90,
				telemetryReadings: [],
			});
			emit({
				type: "Launched",
				data: { missionId: workflow.id },
			});
		});

		on("ScrubLaunch", ({ data, command, transition, emit, workflow }) => {
			transition("Scrubbed", {
				name: data.name,
				destination: data.destination,
				crewMembers: data.crewMembers,
				fuelLevel: data.fuelLevel,
				scrubbedAt: new Date(),
				reason: command.payload.reason,
				attemptNumber: 1,
			});
			emit({
				type: "LaunchScrubbed",
				data: { missionId: workflow.id, reason: command.payload.reason },
			});
		});
	});

	router.state("Scrubbed", ({ on }) => {
		on("RetryCountdown", async ({ data, deps, error, transition, emit, workflow }) => {
			const result = await deps.telemetry.validateLaunchWindow(
				data.fuelLevel,
				data.crewMembers.length,
			);
			if (!result.go) {
				error({ code: "LaunchWindowClosed", data: {} });
			}
			transition("Countdown", {
				name: data.name,
				destination: data.destination,
				crewMembers: data.crewMembers,
				fuelLevel: data.fuelLevel,
				countdownStartedAt: new Date(),
				telemetryStatus: "go",
			});
			emit({
				type: "CountdownStarted",
				data: { missionId: workflow.id },
			});
		});
	});

	router.state("Ascending", ({ on }) => {
		on("UpdateTelemetry", ({ data, command, update, emit, workflow }) => {
			update({
				...data,
				altitude: command.payload.altitude,
				velocity: command.payload.velocity,
				heading: command.payload.heading,
				telemetryReadings: [
					...data.telemetryReadings,
					{
						timestamp: new Date().toISOString(),
						altitude: command.payload.altitude,
						velocity: command.payload.velocity,
						heading: command.payload.heading,
					},
				],
			});
			emit({
				type: "TelemetryUpdated",
				data: { missionId: workflow.id, altitude: command.payload.altitude },
			});
		});

		on("AchieveOrbit", ({ data, transition, emit, workflow }) => {
			transition("OrbitAchieved", {
				...data,
				orbitAchievedAt: new Date(),
				finalAltitude: data.altitude,
			});
			emit({
				type: "OrbitAchieved",
				data: { missionId: workflow.id, altitude: data.altitude },
			});
		});

		on("TriggerAbort", ({ data, command, transition, emit, workflow }) => {
			transition("AbortSequence", {
				name: data.name,
				destination: data.destination,
				crewMembers: data.crewMembers,
				abortedAt: new Date(),
				reason: command.payload.reason,
				lastKnownAltitude: data.altitude,
			});
			emit({
				type: "MissionAborted",
				data: { missionId: workflow.id, reason: command.payload.reason },
			});
		});
	});

	return router;
}
