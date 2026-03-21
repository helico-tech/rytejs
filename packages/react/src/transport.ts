import type { WorkflowSnapshot } from "@rytejs/core";
import type { StoredWorkflow } from "@rytejs/core/store";

export interface BroadcastMessage {
	snapshot: WorkflowSnapshot;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

export interface Transport {
	load(id: string): Promise<StoredWorkflow | null>;

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
			error: TransportError;
	  };

export interface TransportError {
	category: "transport";
	code: "NETWORK" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT";
	message: string;
}

export interface TransportSubscription {
	unsubscribe(): void;
}
