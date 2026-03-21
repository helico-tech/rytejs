import type { WorkflowExecutor } from "@rytejs/core/executor";
import type { RedisStoreAdapter } from "./redis-store.ts";
import type { TelemetryService } from "./telemetry.ts";

export function startTrackingLoop(
	store: RedisStoreAdapter,
	// biome-ignore lint/suspicious/noExplicitAny: executor is parameterized with MissionConfig but we only use execute()
	executor: WorkflowExecutor<any>,
	telemetry: TelemetryService,
	intervalMs = 2000,
): { stop: () => void } {
	const timer = setInterval(async () => {
		try {
			const ascending = await store.findByState("Ascending");

			for (const { id } of ascending) {
				try {
					const flightData = await telemetry.getFlightData(id);

					// Load current snapshot to get telemetry readings for analysis
					const stored = await store.load(id);
					if (!stored) continue;

					// biome-ignore lint/suspicious/noExplicitAny: snapshot data shape is validated by Zod at dispatch time
					const data = stored.snapshot.data as any;
					const readings = Array.isArray(data.telemetryReadings) ? data.telemetryReadings : [];

					const analysis = await telemetry.analyzeReadings(readings);

					if (analysis.anomaly) {
						await executor.execute(id, {
							type: "TriggerAbort",
							payload: { reason: analysis.reason ?? "Anomaly detected" },
						});
					} else if (flightData.altitude >= 400) {
						await executor.execute(id, {
							type: "AchieveOrbit",
							payload: {},
						});
					} else {
						await executor.execute(id, {
							type: "UpdateTelemetry",
							payload: {
								altitude: flightData.altitude,
								velocity: flightData.velocity,
								heading: flightData.heading,
							},
						});
					}
				} catch (err) {
					console.error(`[tracking-loop] Error processing mission ${id}:`, err);
				}
			}
		} catch (err) {
			console.error("[tracking-loop] Error fetching ascending missions:", err);
		}
	}, intervalMs);

	return {
		stop() {
			clearInterval(timer);
		},
	};
}
