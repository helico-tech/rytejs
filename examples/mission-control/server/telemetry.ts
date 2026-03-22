export interface LaunchWindowResult {
	go: boolean;
	reason?: string;
}

export interface FlightData {
	altitude: number;
	velocity: number;
	heading: number;
	timestamp: string;
}

export interface TelemetryReading {
	timestamp: string;
	altitude: number;
	velocity: number;
	heading: number;
}

export interface AnomalyResult {
	anomaly: boolean;
	reason?: string;
}

export interface TelemetryService {
	validateLaunchWindow(fuelLevel: number, crewSize: number): Promise<LaunchWindowResult>;
	getFlightData(missionId: string): Promise<FlightData>;
	analyzeReadings(readings: TelemetryReading[]): Promise<AnomalyResult>;
}

function delay(min: number, max: number): Promise<void> {
	const ms = min + Math.random() * (max - min);
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTelemetryService(): TelemetryService {
	const tickCounts = new Map<string, number>();

	return {
		async validateLaunchWindow(fuelLevel: number, crewSize: number): Promise<LaunchWindowResult> {
			await delay(200, 300);
			if (fuelLevel < 80) {
				return { go: false, reason: `Fuel level ${fuelLevel}% is below 80% threshold` };
			}
			if (crewSize === 0) {
				return { go: false, reason: "No crew members assigned" };
			}
			return { go: true };
		},

		async getFlightData(missionId: string): Promise<FlightData> {
			await delay(100, 200);
			const tick = (tickCounts.get(missionId) ?? 0) + 1;
			tickCounts.set(missionId, tick);

			// Altitude increases ~50km/tick with slight acceleration, capped at 500km
			const rawAltitude = 50 * tick + 2 * tick * tick;
			const altitude = Math.min(rawAltitude, 500);

			// Velocity ramps from 2 to 8 km/s, capped at 8
			const rawVelocity = 2 + (6 * tick) / 10;
			const velocity = Math.min(rawVelocity, 8);

			// Heading wobbles around 90 degrees
			const heading = 90 + (Math.random() - 0.5) * 4;

			return {
				altitude,
				velocity,
				heading,
				timestamp: new Date().toISOString(),
			};
		},

		async analyzeReadings(_readings: TelemetryReading[]): Promise<AnomalyResult> {
			await delay(100, 200);
			// ~10% anomaly chance
			if (Math.random() < 0.1) {
				return { anomaly: true, reason: "Anomalous vibration pattern detected" };
			}
			return { anomaly: false };
		},
	};
}
