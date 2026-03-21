import type { WorkflowRouter } from "../router.js";
import type { EventNames, WorkflowConfig } from "../types.js";
import type { ReactorCommand, ReactorContext } from "./types.js";

type AnyHandler = (ctx: {
	// biome-ignore lint/suspicious/noExplicitAny: internal type erasure for heterogeneous handler storage
	event: { type: string; data: any };
	workflowId: string;
}) => ReactorCommand | ReactorCommand[] | null;

interface Registration {
	definitionName: string;
	eventType: string;
	handler: AnyHandler;
}

export class Reactors {
	private readonly registrations: Registration[] = [];

	on<TConfig extends WorkflowConfig, TEvent extends EventNames<TConfig>>(
		router: WorkflowRouter<TConfig>,
		event: TEvent,
		handler: (ctx: ReactorContext<TConfig, TEvent>) => ReactorCommand | ReactorCommand[] | null,
	): this {
		this.registrations.push({
			definitionName: router.definition.name,
			eventType: event as string,
			handler: handler as AnyHandler,
		});
		return this;
	}

	resolve(
		// biome-ignore lint/suspicious/noExplicitAny: accepts any router for type-erased resolution
		router: WorkflowRouter<any>,
		workflowId: string,
		events: Array<{ type: string; data: unknown }>,
	): ReactorCommand[] {
		const definitionName = router.definition.name;
		const commands: ReactorCommand[] = [];

		for (const event of events) {
			for (const reg of this.registrations) {
				if (reg.definitionName !== definitionName) continue;
				if (reg.eventType !== event.type) continue;

				const result = reg.handler({
					event: { type: event.type, data: event.data },
					workflowId,
				});

				if (result === null) continue;
				if (Array.isArray(result)) {
					commands.push(...result);
				} else {
					commands.push(result);
				}
			}
		}

		return commands;
	}
}

export function createReactors(): Reactors {
	return new Reactors();
}
