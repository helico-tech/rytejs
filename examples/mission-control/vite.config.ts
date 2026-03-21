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
				// Prevent proxy from requesting compressed responses — SSE requires unbuffered streaming
				headers: { "Accept-Encoding": "identity" },
				// Skip proxy for browser navigation (SPA deep links like /missions/:id)
				bypass(req) {
					if (req.headers.accept?.includes("text/html")) {
						return "/index.html";
					}
				},
			},
		},
	},
});
