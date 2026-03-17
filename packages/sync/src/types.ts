import type { PipelineError, WorkflowConfig, WorkflowSnapshot } from "@rytejs/core";

export interface TransportError {
	category: "transport";
	code: "NETWORK" | "TIMEOUT" | "SERVER" | "PARSE";
	message: string;
	cause?: unknown;
}

export type CommandResult =
	| { ok: true; snapshot: WorkflowSnapshot; version: number }
	| { ok: false; error: PipelineError<WorkflowConfig> | TransportError };

export interface UpdateMessage {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface Subscription {
	unsubscribe(): void;
}

export interface CommandTransport {
	dispatch(workflowId: string, command: { type: string; payload: unknown }): Promise<CommandResult>;
}

export interface UpdateTransport {
	subscribe(workflowId: string, listener: (message: UpdateMessage) => void): Subscription;
}

export interface SyncTransport extends CommandTransport, UpdateTransport {}
