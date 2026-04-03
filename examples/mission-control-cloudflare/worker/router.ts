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
				error("LaunchWindowClosed", {});
			}
			transition("Countdown", {
				...data,
				countdownStartedAt: new Date(),
				telemetryStatus: "go",
				secondsRemaining: 10,
			});
			emit("CountdownStarted", { missionId: workflow.id });
		});

		on("CancelMission", ({ data, command, transition, emit, workflow }) => {
			transition("Cancelled", {
				name: data.name,
				destination: data.destination,
				crewMembers: data.crewMembers,
				cancelledAt: new Date(),
				reason: command.payload.reason,
			});
			emit("MissionCancelled", { missionId: workflow.id, reason: command.payload.reason });
		});
	});

	router.state("Countdown", ({ on }) => {
		on("UpdateCountdown", ({ data, command, update, emit, workflow }) => {
			update({
				...data,
				secondsRemaining: command.payload.secondsRemaining,
			});
			emit("CountdownTick", {
				missionId: workflow.id,
				secondsRemaining: command.payload.secondsRemaining,
			});
		});

		on("Launch", ({ data, transition, emit, workflow }) => {
			transition("Ascending", {
				...data,
				launchedAt: new Date(),
				altitude: 0,
				velocity: 0,
				heading: 90,
				telemetryReadings: [],
			});
			emit("Launched", { missionId: workflow.id });
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
			emit("LaunchScrubbed", { missionId: workflow.id, reason: command.payload.reason });
		});
	});

	router.state("Scrubbed", ({ on }) => {
		on("RetryCountdown", async ({ data, deps, error, transition, emit, workflow }) => {
			const result = await deps.telemetry.validateLaunchWindow(
				data.fuelLevel,
				data.crewMembers.length,
			);
			if (!result.go) {
				error("LaunchWindowClosed", {});
			}
			transition("Countdown", {
				name: data.name,
				destination: data.destination,
				crewMembers: data.crewMembers,
				fuelLevel: data.fuelLevel,
				countdownStartedAt: new Date(),
				telemetryStatus: "go",
				secondsRemaining: 10,
			});
			emit("CountdownStarted", { missionId: workflow.id });
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
			emit("TelemetryUpdated", { missionId: workflow.id, altitude: command.payload.altitude });
		});

		on("AchieveOrbit", ({ data, transition, emit, workflow }) => {
			transition("OrbitAchieved", {
				...data,
				orbitAchievedAt: new Date(),
				finalAltitude: data.altitude,
			});
			emit("OrbitAchieved", { missionId: workflow.id, altitude: data.altitude });
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
			emit("MissionAborted", { missionId: workflow.id, reason: command.payload.reason });
		});
	});

	router.state("OrbitAchieved", ({ on }) => {
		on("Archive", ({ data, transition, emit, workflow }) => {
			transition("Archived", {
				previousState: "OrbitAchieved" as const,
				...data,
			});
			emit("MissionArchived", { missionId: workflow.id, previousState: "OrbitAchieved" });
		});
	});

	router.state("AbortSequence", ({ on }) => {
		on("Archive", ({ data, transition, emit, workflow }) => {
			transition("Archived", {
				previousState: "AbortSequence" as const,
				...data,
			});
			emit("MissionArchived", { missionId: workflow.id, previousState: "AbortSequence" });
		});
	});

	router.state("Cancelled", ({ on }) => {
		on("Archive", ({ data, transition, emit, workflow }) => {
			transition("Archived", {
				previousState: "Cancelled" as const,
				...data,
			});
			emit("MissionArchived", { missionId: workflow.id, previousState: "Cancelled" });
		});
	});

	router.state("Archived", ({ on }) => {
		on("Unarchive", ({ data, transition, emit, workflow }) => {
			const { previousState, ...rest } = data;
			emit("MissionUnarchived", { missionId: workflow.id, restoredState: previousState });
			if (previousState === "OrbitAchieved") {
				// biome-ignore lint/suspicious/noExplicitAny: Archived carries union of terminal data, previousState discriminates
				transition("OrbitAchieved", rest as any);
			} else if (previousState === "AbortSequence") {
				// biome-ignore lint/suspicious/noExplicitAny: Archived carries union of terminal data, previousState discriminates
				transition("AbortSequence", rest as any);
			} else {
				// biome-ignore lint/suspicious/noExplicitAny: Archived carries union of terminal data, previousState discriminates
				transition("Cancelled", rest as any);
			}
		});
	});

	return router;
}
