import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/store/index.ts", "src/reactor/index.ts", "src/executor/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
