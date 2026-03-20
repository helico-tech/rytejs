import { defineConfig } from "vitepress";

export default defineConfig({
	base: "/rytejs/",
	title: "Ryte",
	description: "Type-safe workflow engine for TypeScript",
	srcExclude: ["superpowers/**"],
	themeConfig: {
		logo: "/logo.svg",
		nav: [
			{ text: "Guide", link: "/guide/getting-started" },
			{ text: "API", link: "/api/core/src" },
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
						{ text: "Architecture Patterns", link: "/guide/architecture" },
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
						{ text: "Hooks & Plugins", link: "/guide/hooks-and-plugins" },
						{ text: "Serialization", link: "/guide/serialization" },
						{ text: "Migrations", link: "/guide/migrations" },
						{ text: "Integrations", link: "/guide/integrations" },
						{ text: "Observability", link: "/guide/observability" },
						{ text: "Testing", link: "/guide/testing" },
					],
				},
				{
					text: "Packages",
					items: [
						{ text: "Executor", link: "/guide/executor" },
						{ text: "React", link: "/guide/react" },
					],
				},
				{
					text: "Infrastructure",
					items: [
						{ text: "Persistence", link: "/guide/persistence" },
						{ text: "HTTP API", link: "/guide/http-api" },
						{ text: "Real-time", link: "/guide/real-time" },
						{ text: "Transports", link: "/guide/transports" },
						{ text: "Putting It Together", link: "/guide/putting-it-together" },
					],
				},
			],
			"/api/": [
				{
					text: "API Reference",
					items: [
						{ text: "@rytejs/core", link: "/api/core/src" },
						{ text: "@rytejs/testing", link: "/api/testing/src" },
					],
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
		socialLinks: [{ icon: "github", link: "https://github.com/helico-tech/rytejs" }],
	},
});
