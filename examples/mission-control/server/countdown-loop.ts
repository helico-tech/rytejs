import type { WorkflowExecutor } from "@rytejs/core/executor";
import type { RedisStoreAdapter } from "./redis-store.ts";

export function startCountdownLoop(
	store: RedisStoreAdapter,
	// biome-ignore lint/suspicious/noExplicitAny: executor is parameterized with MissionConfig but we only use execute()
	executor: WorkflowExecutor<any>,
	intervalMs = 1000,
): { stop: () => void } {
	const timer = setInterval(async () => {
		try {
			const countdowns = await store.findByState("Countdown");

			for (const { id } of countdowns) {
				try {
					const stored = await store.load(id);
					if (!stored) continue;

					// biome-ignore lint/suspicious/noExplicitAny: snapshot data shape is validated by Zod at dispatch time
					const data = stored.snapshot.data as any;
					const secondsRemaining =
						typeof data.secondsRemaining === "number" ? data.secondsRemaining : 0;

					if (secondsRemaining > 0) {
						await executor.execute(id, {
							type: "UpdateCountdown",
							payload: { secondsRemaining: secondsRemaining - 1 },
						});
					} else {
						// T-0 reached — auto-launch!
						await executor.execute(id, {
							type: "Launch",
							payload: {},
						});
					}
				} catch (err) {
					console.error(`[countdown-loop] Error processing mission ${id}:`, err);
				}
			}
		} catch (err) {
			console.error("[countdown-loop] Error fetching countdown missions:", err);
		}
	}, intervalMs);

	return {
		stop() {
			clearInterval(timer);
		},
	};
}
