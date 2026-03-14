/** The lifecycle hook event names. */
export type HookEvent = "dispatch:start" | "dispatch:end" | "transition" | "error" | "event";

export const HOOK_EVENTS: ReadonlySet<string> = new Set<HookEvent>([
	"dispatch:start",
	"dispatch:end",
	"transition",
	"error",
	"event",
]);

/**
 * Internal registry for lifecycle hook callbacks.
 * Hooks are observers — errors are caught and forwarded, never affecting dispatch.
 */
export class HookRegistry {
	// biome-ignore lint/complexity/noBannedTypes: callbacks have varying signatures per hook event
	private hooks = new Map<string, Function[]>();

	/** Register a callback for a hook event. */
	// biome-ignore lint/complexity/noBannedTypes: callbacks have varying signatures per hook event
	add(event: string, callback: Function): void {
		const existing = this.hooks.get(event) ?? [];
		existing.push(callback);
		this.hooks.set(event, existing);
	}

	/** Emit a hook event, calling all registered callbacks. Errors are caught and forwarded. */
	async emit(event: string, onError: (err: unknown) => void, ...args: unknown[]): Promise<void> {
		const callbacks = this.hooks.get(event);
		if (!callbacks) return;
		for (const cb of callbacks) {
			try {
				await cb(...args);
			} catch (err) {
				onError(err);
			}
		}
	}

	/** Merge another registry's hooks into this one (used by composable routers). */
	merge(other: HookRegistry): void {
		for (const [event, callbacks] of other.hooks) {
			const existing = this.hooks.get(event) ?? [];
			existing.push(...callbacks);
			this.hooks.set(event, existing);
		}
	}
}
