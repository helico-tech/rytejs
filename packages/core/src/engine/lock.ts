const locks = new Map<string, Promise<void>>();

export async function withLock<T>(id: string, fn: () => Promise<T>, timeout: number): Promise<T> {
	const prev = locks.get(id) ?? Promise.resolve();
	let resolve: () => void;
	const gate = new Promise<void>((r) => {
		resolve = r;
	});
	locks.set(id, gate);

	await Promise.race([
		prev,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Lock timeout for ${id}`)), timeout),
		),
	]);

	try {
		return await fn();
	} finally {
		resolve!();
		if (locks.get(id) === gate) locks.delete(id);
	}
}
