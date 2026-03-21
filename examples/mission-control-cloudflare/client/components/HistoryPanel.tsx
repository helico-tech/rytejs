import { useState } from "react";
import { cn } from "../lib/utils.ts";

export interface HistoryEntry {
	seq: number;
	timestamp: string;
	type: "command" | "event";
	name: string;
	data: Record<string, unknown>;
}

interface HistoryPanelProps {
	entries: HistoryEntry[];
}

function formatRelativeTime(timestamp: string): string {
	const now = Date.now();
	const then = new Date(timestamp).getTime();
	const diffMs = now - then;

	if (diffMs < 1000) return "just now";
	if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
	if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
	if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
	return `${Math.floor(diffMs / 86400000)}d ago`;
}

function HistoryEntryItem({ entry }: { entry: HistoryEntry }) {
	const [expanded, setExpanded] = useState(false);
	const isCommand = entry.type === "command";

	return (
		<button type="button" onClick={() => setExpanded(!expanded)} className="w-full text-left group">
			<div className="flex items-start gap-3 py-2 px-2 rounded-md hover:bg-[hsl(var(--secondary))]/50 transition-colors">
				{/* Dot indicator */}
				<div className="mt-1.5 flex-shrink-0">
					<div
						className={cn(
							"w-2 h-2 rounded-full",
							isCommand ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--success))]",
						)}
					/>
				</div>

				{/* Content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
							{entry.name}
						</span>
						<span className="text-[10px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
							{formatRelativeTime(entry.timestamp)}
						</span>
					</div>

					{/* Expanded payload */}
					{expanded && Object.keys(entry.data).length > 0 && (
						<pre className="mt-2 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--secondary))] rounded-md p-2 overflow-x-auto">
							{JSON.stringify(entry.data, null, 2)}
						</pre>
					)}
				</div>
			</div>

			{/* Timeline connector line */}
			<div className="ml-[11px] w-px h-1 bg-[hsl(var(--border))]" />
		</button>
	);
}

export function HistoryPanel({ entries }: HistoryPanelProps) {
	// Most recent entries first
	const sorted = [...entries].sort((a, b) => b.seq - a.seq);

	return (
		<div className="mt-8">
			<div className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-4">
				History
			</div>

			{sorted.length === 0 ? (
				<div className="text-sm text-[hsl(var(--muted-foreground))]/60 py-4">
					No history entries yet
				</div>
			) : (
				<div className="space-y-0">
					{sorted.map((entry) => (
						<HistoryEntryItem key={`${entry.type}-${entry.seq}`} entry={entry} />
					))}
				</div>
			)}
		</div>
	);
}
