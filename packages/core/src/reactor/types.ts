import type { EventData, EventNames, WorkflowConfig } from "../types.js";

export interface ReactorCommand {
	workflowId: string;
	routerName: string;
	command: { type: string; payload: unknown };
}

export interface ReactorContext<
	TConfig extends WorkflowConfig,
	TEvent extends EventNames<TConfig>,
> {
	event: { type: TEvent; data: EventData<TConfig, TEvent> };
	workflowId: string;
}
