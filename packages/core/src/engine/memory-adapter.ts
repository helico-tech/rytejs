import { ConcurrencyConflictError } from "./errors.js";
import type {
	EnqueueMessage,
	LockAdapter,
	QueueAdapter,
	QueueMessage,
	SaveOptions,
	StoreAdapter,
	StoredWorkflow,
	TransactionalAdapter,
} from "./types.js";

let nextId = 0;

export function memoryAdapter(options: {
	ttl: number;
}): StoreAdapter & QueueAdapter & LockAdapter & TransactionalAdapter {
	const store = new Map<string, StoredWorkflow>();
	const pending: QueueMessage[] = [];
	const inflight = new Map<string, QueueMessage>();
	const delayed: Array<{ message: QueueMessage; visibleAt: number }> = [];
	const locks = new Map<string, number>();

	const storeImpl: StoreAdapter = {
		async load(id: string) {
			return store.get(id) ?? null;
		},
		async save(opts: SaveOptions) {
			const existing = store.get(opts.id);
			const currentVersion = existing?.version ?? 0;
			if (currentVersion !== opts.expectedVersion) {
				throw new ConcurrencyConflictError(opts.id, opts.expectedVersion, currentVersion);
			}
			store.set(opts.id, { snapshot: opts.snapshot, version: currentVersion + 1 });
		},
	};

	const queueImpl: QueueAdapter = {
		async enqueue(messages: EnqueueMessage[]) {
			for (const msg of messages) {
				pending.push({ ...msg, id: `msg-${++nextId}`, attempt: 0 });
			}
		},
		async dequeue(count: number) {
			const now = Date.now();
			const stillDelayed: typeof delayed = [];
			for (const entry of delayed) {
				if (now >= entry.visibleAt) {
					pending.push(entry.message);
				} else {
					stillDelayed.push(entry);
				}
			}
			delayed.length = 0;
			delayed.push(...stillDelayed);

			const messages = pending.splice(0, count);
			for (const msg of messages) {
				inflight.set(msg.id, msg);
			}
			return messages;
		},
		async ack(id: string) {
			inflight.delete(id);
		},
		async nack(id: string, delay?: number) {
			const msg = inflight.get(id);
			if (!msg) return;
			inflight.delete(id);
			const retried = { ...msg, attempt: msg.attempt + 1 };
			if (delay && delay > 0) {
				delayed.push({ message: retried, visibleAt: Date.now() + delay });
			} else {
				pending.push(retried);
			}
		},
		async deadLetter(id: string, _reason: string) {
			inflight.delete(id);
		},
	};

	const lockImpl: LockAdapter = {
		async acquire(id: string) {
			const existing = locks.get(id);
			if (existing !== undefined && Date.now() < existing) {
				return false;
			}
			locks.set(id, Date.now() + options.ttl);
			return true;
		},
		async release(id: string) {
			locks.delete(id);
		},
	};

	return {
		load: storeImpl.load,
		save: storeImpl.save,
		enqueue: queueImpl.enqueue,
		dequeue: queueImpl.dequeue,
		ack: queueImpl.ack,
		nack: queueImpl.nack,
		deadLetter: queueImpl.deadLetter,
		acquire: lockImpl.acquire,
		release: lockImpl.release,
		async transaction<T>(
			fn: (tx: { store: StoreAdapter; queue: QueueAdapter }) => Promise<T>,
		): Promise<T> {
			// Snapshot current state for rollback
			const storeBackup = new Map(store);
			const pendingBackup = [...pending];

			try {
				return await fn({ store: storeImpl, queue: queueImpl });
			} catch (err) {
				// Rollback
				store.clear();
				for (const [k, v] of storeBackup) store.set(k, v);
				pending.length = 0;
				pending.push(...pendingBackup);
				throw err;
			}
		},
	};
}
