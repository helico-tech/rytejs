import type { ExecutionEngine, ExecutionResult } from "@rytejs/core/engine";

export interface BroadcasterOptions {
	engine: ExecutionEngine;
}

export interface Broadcaster {
	execute(
		routerName: string,
		workflowId: string,
		command: { type: string; payload: unknown },
	): Promise<ExecutionResult>;
	subscribe(routerName: string, workflowId: string): Promise<Response>;
	connectionCount(routerName: string, workflowId: string): number;
	close(): void;
}
