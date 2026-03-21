import { createWorkflowClient } from "@rytejs/react";
import { useCallback, useEffect, useState } from "react";
import { MissionDetail } from "./components/MissionDetail.tsx";
import { MissionList } from "./components/MissionList.tsx";
import { createMissionTransport } from "./transport.ts";

const transport = createMissionTransport({
	apiUrl: "", // Proxied through Vite → localhost:4000
	sseUrl: "http://localhost:4000", // Direct — SSE doesn't work through Vite's proxy
});
export const client = createWorkflowClient(transport);

function getIdFromUrl(): string | null {
	const match = window.location.pathname.match(/^\/missions\/(.+)$/);
	return match ? match[1] : null;
}

export function App() {
	const [selectedId, setSelectedId] = useState<string | null>(getIdFromUrl);

	const selectMission = useCallback((id: string | null) => {
		setSelectedId(id);
		const path = id ? `/missions/${id}` : "/";
		window.history.pushState(null, "", path);
	}, []);

	useEffect(() => {
		const onPopState = () => setSelectedId(getIdFromUrl());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	return (
		<div className="flex h-screen overflow-hidden">
			<aside className="w-80 flex-shrink-0 border-r border-[hsl(var(--border))] overflow-y-auto">
				<MissionList selectedId={selectedId} onSelect={selectMission} />
			</aside>
			<main className="flex-1 overflow-y-auto">
				{selectedId ? (
					<MissionDetail key={selectedId} id={selectedId} onDeleted={() => selectMission(null)} />
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
