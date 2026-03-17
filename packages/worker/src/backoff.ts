import type { BackoffConfig, BackoffShorthand } from "./types.js";

const SHORTHAND_DEFAULTS: Record<BackoffShorthand, BackoffConfig> = {
	exponential: { strategy: "exponential", base: 1_000, max: 30_000 },
	fixed: { strategy: "fixed", delay: 1_000 },
	linear: { strategy: "linear", delay: 1_000, max: 30_000 },
};

export function resolveBackoff(config: BackoffConfig | BackoffShorthand): BackoffConfig {
	if (typeof config === "string") return SHORTHAND_DEFAULTS[config];
	return config;
}

export function calculateDelay(config: BackoffConfig, attempt: number): number {
	switch (config.strategy) {
		case "fixed":
			return config.delay;
		case "exponential":
			return Math.min(config.base * 2 ** attempt, config.max);
		case "linear":
			return Math.min(config.delay * attempt, config.max);
	}
}
