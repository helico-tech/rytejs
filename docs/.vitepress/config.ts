import { defineConfig } from "vitepress";

export default defineConfig({
	title: "Ryte",
	description: "Type-safe workflow engine for TypeScript",
	themeConfig: {
		nav: [
			{ text: "Guide", link: "/guide/getting-started" },
			{ text: "API", link: "/api/" },
			{ text: "Examples", link: "/examples/basic-workflow" },
		],
		sidebar: {
			"/guide/": [
				{
					text: "Introduction",
					items: [
						{ text: "Getting Started", link: "/guide/getting-started" },
						{ text: "Concepts", link: "/guide/concepts" },
					],
				},
				{
					text: "Core",
					items: [
						{ text: "Defining Workflows", link: "/guide/defining-workflows" },
						{ text: "Routing Commands", link: "/guide/routing-commands" },
						{ text: "State Transitions", link: "/guide/state-transitions" },
					],
				},
				{
					text: "Advanced",
					items: [
						{ text: "Middleware", link: "/guide/middleware" },
						{ text: "Error Handling", link: "/guide/error-handling" },
						{ text: "Events", link: "/guide/events" },
						{ text: "Dependency Injection", link: "/guide/dependency-injection" },
						{ text: "Context Keys", link: "/guide/context-keys" },
					],
				},
			],
			"/api/": [
				{
					text: "API Reference",
					items: [{ text: "Full Reference", link: "/api/" }],
				},
			],
			"/examples/": [
				{
					text: "Examples",
					items: [
						{ text: "Basic Workflow", link: "/examples/basic-workflow" },
						{ text: "Real World", link: "/examples/real-world" },
					],
				},
			],
		},
		socialLinks: [{ icon: "github", link: "https://github.com/helico-tech/ryte" }],
	},
});
