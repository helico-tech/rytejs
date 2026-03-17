import type { WorkflowRouter } from "@rytejs/core";
import type { LockAdapter, QueueAdapter, QueueMessage, StoreAdapter } from "@rytejs/core/engine";

export type BackoffConfig =
	| { strategy: "fixed"; delay: number }
	| { strategy: "exponential"; base: number; max: number }
	| { strategy: "linear"; delay: number; max: number };

export type BackoffShorthand = "exponential" | "fixed" | "linear";

export interface CategoryRetryPolicy {
	action: "retry";
	maxRetries: number;
	backoff: BackoffConfig | BackoffShorthand;
}

export interface CategoryDropPolicy {
	action: "drop";
}

export interface CategoryDeadLetterPolicy {
	action: "dead-letter";
}

export type CategoryPolicy = CategoryRetryPolicy | CategoryDropPolicy | CategoryDeadLetterPolicy;

export interface RetryPolicy {
	dependency: CategoryPolicy;
	unexpected: CategoryPolicy;
	domain: CategoryPolicy;
	validation: CategoryPolicy;
	router: CategoryPolicy;
}

export interface WorkerOptions {
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router array — each router has a different TConfig, type erasure is required
	routers: WorkflowRouter<any>[];
	store: StoreAdapter;
	queue: QueueAdapter;
	lock?: LockAdapter;
	concurrency?: number;
	pollInterval?: number;
	retryPolicy?: Partial<RetryPolicy>;
	shutdownTimeout?: number;
}

export interface WorkerHookPayloads {
	"command:started": { workflowId: string; message: QueueMessage };
	"command:completed": {
		workflowId: string;
		message: QueueMessage;
		result: unknown;
	};
	"command:failed": {
		workflowId: string;
		message: QueueMessage;
		error: unknown;
		action: "retry" | "dead-letter" | "drop";
	};
	"command:retried": {
		workflowId: string;
		message: QueueMessage;
		attempt: number;
		maxRetries: number;
		delay: number;
	};
	"command:dead-lettered": {
		workflowId: string;
		message: QueueMessage;
		error: unknown;
		reason: string;
	};
	"command:dropped": {
		workflowId: string;
		message: QueueMessage;
		error: unknown;
	};
	"worker:started": Record<string, never>;
	"worker:stopped": Record<string, never>;
}

export type WorkerHookEvent = keyof WorkerHookPayloads;

export interface WorkerHookRegistry {
	on<E extends WorkerHookEvent>(event: E, callback: (payload: WorkerHookPayloads[E]) => void): void;
}

export interface WorkerPlugin {
	(hooks: WorkerHookRegistry): void;
	readonly __brand: "@rytejs/worker/plugin";
}
