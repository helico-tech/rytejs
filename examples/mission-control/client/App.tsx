import { createWorkflowClient } from "@rytejs/react";
import { useState } from "react";
import { MissionDetail } from "./components/MissionDetail.tsx";
import { MissionList } from "./components/MissionList.tsx";
import { createMissionTransport } from "./transport.ts";

const transport = createMissionTransport({
	apiUrl: "", // Proxied through Vite → localhost:4000
	sseUrl: "http://localhost:4000", // Direct — SSE doesn't work through Vite's proxy
});
export const client = createWorkflowClient(transport);

export function App() {
	const [selectedId, setSelectedId] = useState<string | null>(null);

	return (
		<div className="flex h-screen overflow-hidden">
			<aside className="w-80 flex-shrink-0 border-r border-[hsl(var(--border))] overflow-y-auto">
				<MissionList selectedId={selectedId} onSelect={setSelectedId} />
			</aside>
			<main className="flex-1 overflow-y-auto">
				{selectedId ? (
					<MissionDetail key={selectedId} id={selectedId} />
				) : (
					<div className="flex items-center justify-center h-full">
						<div className="text-center">
							<div className="text-[hsl(var(--muted-foreground))] text-lg mb-2">
								No mission selected
							</div>
							<div className="text-[hsl(var(--muted-foreground))] text-sm opacity-60">
								Select a mission from the sidebar or create a new one
							</div>
						</div>
					</div>
				)}
			</main>
		</div>
	);
}
