import { describe, expect, test } from "bun:test";
import { createTelemetryService } from "../telemetry.ts";

describe("TelemetryService", () => {
	describe("validateLaunchWindow", () => {
		test("go when fuel >= 80 and crew non-empty", async () => {
			const telemetry = createTelemetryService();
			const result = await telemetry.validateLaunchWindow(85, 3);
			expect(result.go).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		test("no-go when fuel < 80", async () => {
			const telemetry = createTelemetryService();
			const result = await telemetry.validateLaunchWindow(75, 3);
			expect(result.go).toBe(false);
			expect(result.reason).toBeDefined();
		});

		test("no-go when crew empty", async () => {
			const telemetry = createTelemetryService();
			const result = await telemetry.validateLaunchWindow(90, 0);
			expect(result.go).toBe(false);
			expect(result.reason).toBeDefined();
		});
	});

	describe("getFlightData", () => {
		test("altitude increases over successive calls", async () => {
			const telemetry = createTelemetryService();
			const first = await telemetry.getFlightData("mission-1");
			const second = await telemetry.getFlightData("mission-1");
			const third = await telemetry.getFlightData("mission-1");

			expect(second.altitude).toBeGreaterThan(first.altitude);
			expect(third.altitude).toBeGreaterThan(second.altitude);
		});

		test("heading near 90 degrees", async () => {
			const telemetry = createTelemetryService();
			const data = await telemetry.getFlightData("mission-2");
			expect(data.heading).toBeGreaterThan(85);
			expect(data.heading).toBeLessThan(95);
		});

		test("different missions have independent tracking", async () => {
			const telemetry = createTelemetryService();
			const a1 = await telemetry.getFlightData("alpha");
			const a2 = await telemetry.getFlightData("alpha");
			const b1 = await telemetry.getFlightData("bravo");

			// alpha is on tick 2, bravo is on tick 1
			expect(a2.altitude).toBeGreaterThan(a1.altitude);
			// bravo tick 1 should equal alpha tick 1 (same formula, same tick)
			expect(b1.altitude).toBe(a1.altitude);
		});
	});

	describe("analyzeReadings", () => {
		test("returns boolean anomaly", async () => {
			const telemetry = createTelemetryService();
			const result = await telemetry.analyzeReadings([
				{ timestamp: new Date().toISOString(), altitude: 100, velocity: 3, heading: 90 },
			]);
			expect(typeof result.anomaly).toBe("boolean");
		});
	});
});
