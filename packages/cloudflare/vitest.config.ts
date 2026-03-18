import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"cloudflare:workers": path.resolve(__dirname, "__mocks__/cloudflare-workers.ts"),
		},
	},
	test: {
		passWithNoTests: true,
	},
});
