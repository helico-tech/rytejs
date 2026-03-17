import type { CommandResult, CommandTransport } from "../types.js";

export function mockCommandTransport(
	handler: (
		workflowId: string,
		command: { type: string; payload: unknown },
	) => CommandResult | Promise<CommandResult>,
): CommandTransport {
	return {
		async dispatch(workflowId, command) {
			return handler(workflowId, command);
		},
	};
}
