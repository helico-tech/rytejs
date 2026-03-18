import type { LockAdapter } from "@rytejs/core/engine";

export function cloudflareLock(): LockAdapter {
	return {
		async acquire() {
			return true;
		},
		async release() {},
	};
}
