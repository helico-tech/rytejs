import type { WorkflowSnapshot } from "../snapshot.js";
import type { StoredWorkflow } from "../store/types.js";
import type { DispatchResult, PipelineError, WorkflowConfig } from "../types.js";

// ── Context ──

export interface ExecutorContext {
	readonly id: string;
	readonly command: { type: string; payload: unknown };
	readonly stored: StoredWorkflow;

	result: DispatchResult<WorkflowConfig> | { ok: false; error: ExecutorError } | null;
	snapshot: WorkflowSnapshot | null;
	events: Array<{ type: string; data: unknown }>;
}

// ── Middleware ──

export type ExecutorMiddleware = (ctx: ExecutorContext, next: () => Promise<void>) => Promise<void>;

// ── Errors ──

export type ExecutorError =
	| { category: "not_found"; id: string }
	| { category: "conflict"; id: string; expectedVersion: number; actualVersion: number }
	| { category: "restore"; id: string; issues: unknown[] }
	| { category: "unexpected"; error: unknown; message: string };

// ── Result ──

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
