import type { WorkflowRouter } from "@rytejs/core";
import type { EnqueueMessage } from "@rytejs/core/engine";

interface ReactorCommand {
	workflowId: string;
	// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic is inferred at registration, not at resolve time
	router: WorkflowRouter<any>;
	command: { type: string; payload: unknown };
}

type ReactorCallback = (ctx: {
	event: { type: string; data: unknown };
	workflowId: string;
}) => ReactorCommand | ReactorCommand[] | null;

interface ReactorEntry {
	definitionName: string;
	eventType: string;
	callback: ReactorCallback;
}

export class WorkerReactors {
	private readonly entries: ReactorEntry[] = [];

	on(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic differs per call
		router: WorkflowRouter<any>,
		eventType: string,
		callback: ReactorCallback,
	): this {
		this.entries.push({
			definitionName: router.definition.name,
			eventType,
			callback,
		});
		return this;
	}

	resolve(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — router generic differs per call
		router: WorkflowRouter<any>,
		workflowId: string,
		events: Array<{ type: string; data: unknown }>,
	): EnqueueMessage[] {
		const results: EnqueueMessage[] = [];
		const defName = router.definition.name;

		for (const event of events) {
			for (const entry of this.entries) {
				if (entry.definitionName !== defName || entry.eventType !== event.type) continue;

				const result = entry.callback({ event, workflowId });
				if (!result) continue;

				const commands = Array.isArray(result) ? result : [result];
				for (const cmd of commands) {
					results.push({
						workflowId: cmd.workflowId,
						routerName: cmd.router.definition.name,
						type: cmd.command.type,
						payload: cmd.command.payload,
					});
				}
			}
		}

		return results;
	}
}
