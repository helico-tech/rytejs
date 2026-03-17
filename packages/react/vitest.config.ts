import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		passWithNoTests: true,
		pool: "threads",
		poolOptions: {
			threads: { maxThreads: 2 },
		},
	},
});
