import { describe, expect, test } from "bun:test";
import type { Workflow } from "@rytejs/core";
import type { MissionConfig } from "../../shared/mission.ts";
import { missionDef } from "../../shared/mission.ts";
import { createMissionRouter } from "../router.ts";
import type { TelemetryService } from "../telemetry.ts";

function createMockTelemetry(go = true): TelemetryService {
	return {
		async validateLaunchWindow() {
			return go ? { go: true } : { go: false, reason: "Window closed" };
		},
		async getFlightData() {
			return { altitude: 100, velocity: 5, heading: 90, timestamp: new Date().toISOString() };
		},
		async analyzeReadings() {
			return { anomaly: false };
		},
	};
}

function planningWorkflow(id = "mission-1"): Workflow<MissionConfig> {
	return missionDef.createWorkflow(id, {
		initialState: "Planning",
		data: {
			name: "Apollo",
			destination: "Moon",
			crewMembers: ["Armstrong", "Aldrin"],
			fuelLevel: 95,
		},
	});
}

function countdownWorkflow(id = "mission-1"): Workflow<MissionConfig> {
	return missionDef.createWorkflow(id, {
		initialState: "Countdown",
		data: {
			name: "Apollo",
			destination: "Moon",
			crewMembers: ["Armstrong", "Aldrin"],
			fuelLevel: 95,
			countdownStartedAt: new Date(),
			telemetryStatus: "go",
		},
	});
}

function scrubbedWorkflow(id = "mission-1"): Workflow<MissionConfig> {
	return missionDef.createWorkflow(id, {
		initialState: "Scrubbed",
		data: {
			name: "Apollo",
			destination: "Moon",
			crewMembers: ["Armstrong", "Aldrin"],
			fuelLevel: 95,
			scrubbedAt: new Date(),
			reason: "Weather",
			attemptNumber: 1,
		},
	});
}

function ascendingWorkflow(id = "mission-1"): Workflow<MissionConfig> {
	return missionDef.createWorkflow(id, {
		initialState: "Ascending",
		data: {
			name: "Apollo",
			destination: "Moon",
			crewMembers: ["Armstrong", "Aldrin"],
			fuelLevel: 95,
			countdownStartedAt: new Date(),
			telemetryStatus: "go",
			launchedAt: new Date(),
			altitude: 150,
			velocity: 4,
			heading: 90,
			telemetryReadings: [],
		},
	});
}

describe("Mission Router", () => {
	test("Planning -> Countdown (go)", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry(true) });
		const wf = planningWorkflow();

		const result = await router.dispatch(wf, { type: "InitiateCountdown", payload: {} });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Countdown");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("CountdownStarted");
	});

	test("Planning -> Countdown (no-go = LaunchWindowClosed error)", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry(false) });
		const wf = planningWorkflow();

		const result = await router.dispatch(wf, { type: "InitiateCountdown", payload: {} });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("LaunchWindowClosed");
		}
	});

	test("Planning -> Cancelled", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry() });
		const wf = planningWorkflow();

		const result = await router.dispatch(wf, {
			type: "CancelMission",
			payload: { reason: "Budget cuts" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Cancelled");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("MissionCancelled");
	});

	test("Countdown -> Ascending", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry() });
		const wf = countdownWorkflow();

		const result = await router.dispatch(wf, { type: "Launch", payload: {} });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Ascending");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("Launched");
		if (result.workflow.state === "Ascending") {
			expect(result.workflow.data.altitude).toBe(0);
			expect(result.workflow.data.velocity).toBe(0);
			expect(result.workflow.data.telemetryReadings).toEqual([]);
		}
	});

	test("Countdown -> Scrubbed", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry() });
		const wf = countdownWorkflow();

		const result = await router.dispatch(wf, {
			type: "ScrubLaunch",
			payload: { reason: "Lightning" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Scrubbed");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("LaunchScrubbed");
	});

	test("Scrubbed -> Countdown (retry)", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry(true) });
		const wf = scrubbedWorkflow();

		const result = await router.dispatch(wf, { type: "RetryCountdown", payload: {} });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Countdown");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("CountdownStarted");
	});

	test("Ascending + UpdateTelemetry", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry() });
		const wf = ascendingWorkflow();

		const result = await router.dispatch(wf, {
			type: "UpdateTelemetry",
			payload: { altitude: 200, velocity: 5, heading: 91 },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Ascending");
		if (result.workflow.state === "Ascending") {
			expect(result.workflow.data.altitude).toBe(200);
			expect(result.workflow.data.velocity).toBe(5);
			expect(result.workflow.data.heading).toBe(91);
			expect(result.workflow.data.telemetryReadings).toHaveLength(1);
			expect(result.workflow.data.telemetryReadings[0]?.altitude).toBe(200);
		}
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("TelemetryUpdated");
	});

	test("Ascending -> OrbitAchieved", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry() });
		const wf = ascendingWorkflow();

		const result = await router.dispatch(wf, { type: "AchieveOrbit", payload: {} });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("OrbitAchieved");
		if (result.workflow.state === "OrbitAchieved") {
			expect(result.workflow.data.finalAltitude).toBe(150);
		}
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("OrbitAchieved");
	});

	test("Ascending -> AbortSequence", async () => {
		const router = createMissionRouter({ telemetry: createMockTelemetry() });
		const wf = ascendingWorkflow();

		const result = await router.dispatch(wf, {
			type: "TriggerAbort",
			payload: { reason: "Engine failure" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("AbortSequence");
		if (result.workflow.state === "AbortSequence") {
			expect(result.workflow.data.lastKnownAltitude).toBe(150);
			expect(result.workflow.data.reason).toBe("Engine failure");
		}
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("MissionAborted");
	});
});
