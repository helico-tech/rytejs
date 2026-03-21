import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: "client",
	plugins: [tailwindcss(), react()],
	server: {
		proxy: {
			"/missions": {
				target: "http://localhost:4000",
				changeOrigin: true,
			},
		},
	},
});
