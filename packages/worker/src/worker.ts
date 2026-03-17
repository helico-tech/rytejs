import type { WorkflowRouter } from "@rytejs/core";
import {
	createEngine,
	LockConflictError,
	type QueueAdapter,
	type QueueMessage,
} from "@rytejs/core/engine";
import { calculateDelay, resolveBackoff } from "./backoff.js";
import { createWorkerHooks, type WorkerHooks } from "./hooks.js";
import { WorkerReactors } from "./reactors.js";
import type {
	RetryPolicy,
	WorkerHookEvent,
	WorkerHookPayloads,
	WorkerOptions,
	WorkerPlugin,
} from "./types.js";

const DEFAULT_RETRY_POLICY: RetryPolicy = {
	dependency: { action: "retry", maxRetries: 3, backoff: "exponential" },
	unexpected: { action: "dead-letter" },
	domain: { action: "dead-letter" },
	validation: { action: "drop" },
	router: { action: "drop" },
};

export class Worker {
	private readonly engine: ReturnType<typeof createEngine>;
	private readonly queue: QueueAdapter;
	private readonly reactors = new WorkerReactors();
	private readonly hooks: WorkerHooks;
	private readonly retryPolicy: RetryPolicy;
	private readonly concurrency: number;
	private readonly pollInterval: number;
	private readonly shutdownTimeout: number;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous router map
	private readonly routerMap: Record<string, WorkflowRouter<any>>;
	private running = false;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private inflight = 0;

	constructor(options: WorkerOptions) {
		this.routerMap = {};
		for (const router of options.routers) {
			const name = router.definition.name;
			if (this.routerMap[name]) {
				throw new Error(`Duplicate router definition name: "${name}"`);
			}
			this.routerMap[name] = router;
		}

		this.engine = createEngine({
			store: options.store,
			routers: this.routerMap,
			lock: options.lock,
			queue: options.queue,
		});

		this.queue = options.queue;
		this.hooks = createWorkerHooks();
		this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
		this.concurrency = options.concurrency ?? 1;
		this.pollInterval = options.pollInterval ?? 1_000;
		this.shutdownTimeout = options.shutdownTimeout ?? 30_000;
	}

	on<E extends WorkerHookEvent>(
		event: E,
		callback: (payload: WorkerHookPayloads[E]) => void,
	): void {
		this.hooks.on(event, callback);
	}

	use(plugin: WorkerPlugin): void {
		plugin(this.hooks);
	}

	react(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure for reactor registration
		router: WorkflowRouter<any>,
		eventType: string,
		callback: Parameters<WorkerReactors["on"]>[2],
	): this {
		this.reactors.on(router, eventType, callback);
		return this;
	}

	async send(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic is inferred at call site
		router: WorkflowRouter<any>,
		workflowId: string,
		command: { type: string; payload: unknown },
	): Promise<void> {
		await this.queue.enqueue([
			{
				workflowId,
				routerName: router.definition.name,
				type: command.type,
				payload: command.payload,
			},
		]);
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.hooks.emit("worker:started", {});
		this.poll();
	}

	async stop(): Promise<void> {
		this.running = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		if (this.inflight > 0) {
			await Promise.race([
				new Promise<void>((resolve) => {
					const check = () => {
						if (this.inflight <= 0) {
							resolve();
						} else {
							setTimeout(check, 50);
						}
					};
					setTimeout(check, 50);
				}),
				new Promise<void>((resolve) => setTimeout(resolve, this.shutdownTimeout)),
			]);
		}

		this.hooks.emit("worker:stopped", {});
	}

	private poll(): void {
		if (!this.running) return;

		const available = this.concurrency - this.inflight;
		if (available <= 0) {
			this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
			return;
		}

		this.queue.dequeue(available).then((messages) => {
			for (const msg of messages) {
				this.inflight++;
				this.processMessage(msg).finally(() => {
					this.inflight--;
				});
			}

			if (this.running) {
				this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
			}
		});
	}

	private async processMessage(message: QueueMessage): Promise<void> {
		const router = this.routerMap[message.routerName];
		if (!router) {
			await this.queue.deadLetter(message.id, "no_router");
			this.hooks.emit("command:dead-lettered", {
				workflowId: message.workflowId,
				message,
				error: new Error(`No router for "${message.routerName}"`),
				reason: "no_router",
			});
			return;
		}

		const definition = router.definition;

		if (definition.hasCommand(message.type)) {
			await this.processCommand(message);
		} else if (definition.hasEvent(message.type)) {
			await this.processEvent(message, router);
		} else {
			await this.queue.deadLetter(message.id, "unknown_type");
			this.hooks.emit("command:dead-lettered", {
				workflowId: message.workflowId,
				message,
				error: new Error(`Unknown type "${message.type}" for router "${message.routerName}"`),
				reason: "unknown_type",
			});
		}
	}

	private async processCommand(message: QueueMessage): Promise<void> {
		this.hooks.emit("command:started", {
			workflowId: message.workflowId,
			message,
		});

		try {
			const execResult = await this.engine.execute(message.routerName, message.workflowId, {
				type: message.type,
				payload: message.payload,
			});

			if (execResult.result.ok) {
				await this.queue.ack(message.id);
				this.hooks.emit("command:completed", {
					workflowId: message.workflowId,
					message,
					result: execResult,
				});
			} else {
				const error = execResult.result.error;
				await this.handleError(message, error.category, error);
			}
		} catch (err) {
			if (err instanceof LockConflictError) {
				await this.queue.nack(message.id, 100);
				return;
			}
			await this.handleError(message, "unexpected", err);
		}
	}

	private async processEvent(
		message: QueueMessage,
		// biome-ignore lint/suspicious/noExplicitAny: type erasure for reactor resolution
		router: WorkflowRouter<any>,
	): Promise<void> {
		try {
			const commands = this.reactors.resolve(router, message.workflowId, [
				{ type: message.type, data: message.payload },
			]);

			if (commands.length > 0) {
				await this.queue.enqueue(commands);
			}

			await this.queue.ack(message.id);
		} catch {
			await this.queue.nack(message.id);
		}
	}

	private async handleError(
		message: QueueMessage,
		category: string,
		error: unknown,
	): Promise<void> {
		const policy = this.retryPolicy[category as keyof RetryPolicy] ?? {
			action: "dead-letter" as const,
		};

		const action = policy.action;

		this.hooks.emit("command:failed", {
			workflowId: message.workflowId,
			message,
			error,
			action,
		});

		if (action === "retry") {
			const retryPolicy = policy as {
				maxRetries: number;
				backoff: unknown;
			};
			if (message.attempt >= retryPolicy.maxRetries) {
				await this.queue.deadLetter(message.id, category);
				this.hooks.emit("command:dead-lettered", {
					workflowId: message.workflowId,
					message,
					error,
					reason: category,
				});
			} else {
				const backoff = resolveBackoff(retryPolicy.backoff as Parameters<typeof resolveBackoff>[0]);
				const delay = calculateDelay(backoff, message.attempt);
				await this.queue.nack(message.id, delay);
				this.hooks.emit("command:retried", {
					workflowId: message.workflowId,
					message,
					attempt: message.attempt,
					maxRetries: retryPolicy.maxRetries,
					delay,
				});
			}
		} else if (action === "dead-letter") {
			await this.queue.deadLetter(message.id, category);
			this.hooks.emit("command:dead-lettered", {
				workflowId: message.workflowId,
				message,
				error,
				reason: category,
			});
		} else {
			// drop
			await this.queue.ack(message.id);
			this.hooks.emit("command:dropped", {
				workflowId: message.workflowId,
				message,
				error,
			});
		}
	}
}

export function createWorker(options: WorkerOptions): Worker {
	return new Worker(options);
}
