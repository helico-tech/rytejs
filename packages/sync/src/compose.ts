import type { CommandTransport, SyncTransport, UpdateTransport } from "./types.js";

export function composeSyncTransport(adapters: {
	commands: CommandTransport;
	updates: UpdateTransport;
}): SyncTransport {
	return {
		dispatch: (workflowId, command) => adapters.commands.dispatch(workflowId, command),
		subscribe: (workflowId, listener) => adapters.updates.subscribe(workflowId, listener),
	};
}
