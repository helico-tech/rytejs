import type { StoredWorkflow } from "../engine/types.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { DispatchResult, PipelineError, WorkflowConfig } from "../types.js";

// ── Context ──

export interface ExecutorContextBase {
	readonly id: string;
	readonly expectedVersion?: number;

	stored: StoredWorkflow | null;
	result: DispatchResult<WorkflowConfig> | null;
	snapshot: WorkflowSnapshot | null;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

export interface ExecuteContext extends ExecutorContextBase {
	readonly operation: "execute";
	readonly command: { type: string; payload: unknown };
}

export interface CreateContext extends ExecutorContextBase {
	readonly operation: "create";
	readonly init: { initialState: string; data: unknown };
}

export type ExecutorContext = ExecuteContext | CreateContext;

// ── Middleware ──

export type ExecutorMiddleware = (ctx: ExecutorContext, next: () => Promise<void>) => Promise<void>;

// ── Result ──

export type ExecutorError =
	| { category: "not_found"; id: string }
	| { category: "conflict"; id: string; expectedVersion: number; actualVersion: number }
	| { category: "already_exists"; id: string }
	| { category: "restore"; id: string; issues: unknown[] }
	| { category: "unexpected"; error: unknown };

export type ExecutionResult =
	| {
			ok: true;
			snapshot: WorkflowSnapshot;
			version: number;
			events: Array<{ type: string; data: unknown }>;
	  }
	| {
			ok: false;
			error: PipelineError<WorkflowConfig> | ExecutorError;
	  };

// ── Broadcast ──

export interface BroadcastMessage {
	snapshot: WorkflowSnapshot;
	version: number;
	events: Array<{ type: string; data: unknown }>;
}

export interface SubscriberRegistry {
	subscribe(id: string, callback: (message: BroadcastMessage) => void): () => void;
	notify(id: string, message: BroadcastMessage): void;
}
