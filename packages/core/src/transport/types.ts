import type { BroadcastMessage } from "../executor/types.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { PipelineError, WorkflowConfig } from "../types.js";

export type { BroadcastMessage };

export interface Transport {
	dispatch(
		id: string,
		command: { type: string; payload: unknown },
		expectedVersion: number,
	): Promise<TransportResult>;

	subscribe(id: string, callback: (message: BroadcastMessage) => void): TransportSubscription;
}

export type TransportResult =
	| {
			ok: true;
			snapshot: WorkflowSnapshot;
			version: number;
			events: Array<{ type: string; data: unknown }>;
	  }
	| {
			ok: false;
			error: TransportError | PipelineError<WorkflowConfig>;
	  };

export interface TransportError {
	category: "transport";
	code: "NETWORK" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT";
	message: string;
}

export interface TransportSubscription {
	unsubscribe(): void;
}
