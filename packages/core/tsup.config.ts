import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/engine/index.ts", "src/reactor/index.ts", "src/http/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
