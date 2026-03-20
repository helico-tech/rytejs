import type { WorkflowRouter } from "../router.js";
import type { WorkflowSnapshot } from "../snapshot.js";
import type { DispatchResult, WorkflowConfig } from "../types.js";

export interface StoredWorkflow {
	snapshot: WorkflowSnapshot;
	version: number;
}

export interface SaveOptions {
	id: string;
	snapshot: WorkflowSnapshot;
	expectedVersion: number;
	events?: Array<{ type: string; data: unknown }>;
}

export interface StoreAdapter {
	load(id: string): Promise<StoredWorkflow | null>;
	save(options: SaveOptions): Promise<void>;
}

export interface EnqueueMessage {
	workflowId: string;
	routerName: string;
	type: string;
	payload: unknown;
}

export interface QueueMessage extends EnqueueMessage {
	id: string;
	attempt: number;
}

export interface QueueAdapter {
	enqueue(messages: EnqueueMessage[]): Promise<void>;
	dequeue(count: number): Promise<QueueMessage[]>;
	ack(id: string): Promise<void>;
	nack(id: string, delay?: number): Promise<void>;
	deadLetter(id: string, reason: string): Promise<void>;
}

export interface LockAdapter {
	acquire(id: string): Promise<boolean>;
	release(id: string): Promise<void>;
}

export interface TransactionalAdapter {
	transaction<T>(fn: (tx: { store: StoreAdapter; queue: QueueAdapter }) => Promise<T>): Promise<T>;
}

export interface EmittedEvent {
	type: string;
	data: unknown;
}

export interface EngineOptions {
	store: StoreAdapter;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router map — each router has a different TConfig, type erasure is required
	routers: Record<string, WorkflowRouter<any>>;
	lock?: LockAdapter;
	queue?: QueueAdapter;
}

export interface ExecutionResult {
	result: DispatchResult<WorkflowConfig>;
	events: EmittedEvent[];
	version: number;
}
