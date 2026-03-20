import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/store/index.ts",
		"src/reactor/index.ts",
		"src/http/index.ts",
		"src/executor/index.ts",
		"src/transport/index.ts",
		"src/transport/server/index.ts",
	],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
