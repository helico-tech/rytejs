import type { ContextKey } from "./key.js";
import type { WorkflowDefinition } from "./definition.js";
import type {
	CommandNames,
	CommandPayload,
	ErrorCodes,
	ErrorData,
	EventData,
	EventNames,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowOf,
} from "./types.js";
import { DomainErrorSignal, ValidationError } from "./types.js";

/** Mutable context flowing through the middleware pipeline during dispatch. */
export interface Context<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig> = StateNames<TConfig>,
	TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> {
	readonly command: {
		readonly type: TCommand;
		readonly payload: CommandPayload<TConfig, TCommand>;
	};
	readonly workflow: WorkflowOf<TConfig, TState>;
	readonly deps: TDeps;

	readonly data: StateData<TConfig, TState>;
	update(data: Partial<StateData<TConfig, TState>>): void;

	transition<Target extends StateNames<TConfig>>(
		target: Target,
		data: StateData<TConfig, Target>,
	): void;

	emit<E extends EventNames<TConfig>>(event: { type: E; data: EventData<TConfig, E> }): void;
	readonly events: ReadonlyArray<{ type: EventNames<TConfig>; data: unknown }>;

	error<C extends ErrorCodes<TConfig>>(err: { code: C; data: ErrorData<TConfig, C> }): never;

	set<T>(key: ContextKey<T>, value: T): void;
	get<T>(key: ContextKey<T>): T;
	getOrNull<T>(key: ContextKey<T>): T | undefined;

	/** @internal — not part of the handler API */
	getWorkflowSnapshot(): Workflow<TConfig>;
}

interface DomainEvent {
	type: string;
	data: unknown;
}

/** @internal Creates a context for dispatch. Not part of public API. */
export function createContext<TConfig extends WorkflowConfig, TDeps>(
	definition: WorkflowDefinition<TConfig>,
	originalWorkflow: Workflow<TConfig>,
	command: { type: string; payload: unknown },
	deps: TDeps,
): Context<TConfig, TDeps> {
	let mutableState = originalWorkflow.state;
	let mutableData: Record<string, unknown> = {
		...(originalWorkflow.data as Record<string, unknown>),
	};

	const accumulatedEvents: DomainEvent[] = [];
	const middlewareState = new Map<symbol, unknown>();

	const ctx = {
		command,
		workflow: originalWorkflow,
		deps,

		get data() {
			return { ...mutableData } as StateData<TConfig, StateNames<TConfig>>;
		},

		update(data: Record<string, unknown>) {
			const merged = { ...mutableData, ...data };
			const schema = definition.getStateSchema(mutableState);
			const result = schema.safeParse(merged);
			if (!result.success) {
				throw new ValidationError("state", result.error.issues);
			}
			mutableData = result.data as Record<string, unknown>;
		},

		transition(target: string, data: unknown) {
			if (!definition.hasState(target)) {
				throw new Error(`Unknown state: ${target}`);
			}
			const schema = definition.getStateSchema(target);
			const result = schema.safeParse(data);
			if (!result.success) {
				throw new ValidationError("transition", result.error.issues);
			}
			mutableState = target;
			mutableData = result.data as Record<string, unknown>;
		},

		emit(event: { type: string; data: unknown }) {
			const schema = definition.getEventSchema(event.type);
			const result = schema.safeParse(event.data);
			if (!result.success) {
				throw new ValidationError("event", result.error.issues);
			}
			accumulatedEvents.push({ type: event.type, data: result.data });
		},

		get events() {
			return [...accumulatedEvents];
		},

		error(err: { code: string; data: unknown }) {
			const schema = definition.getErrorSchema(err.code);
			const result = schema.safeParse(err.data);
			if (!result.success) {
				throw new Error(
					`Invalid error data for '${err.code}': ${result.error.issues.map((i) => i.message).join(", ")}`,
				);
			}
			throw new DomainErrorSignal(err.code, result.data);
		},

		set<T>(key: ContextKey<T>, value: T) {
			middlewareState.set(key.id, value);
		},

		get<T>(key: ContextKey<T>): T {
			if (!middlewareState.has(key.id)) {
				throw new Error(`Context key not set: ${key.id.toString()}`);
			}
			return middlewareState.get(key.id) as T;
		},

		getOrNull<T>(key: ContextKey<T>): T | undefined {
			return middlewareState.get(key.id) as T | undefined;
		},

		getWorkflowSnapshot(): Workflow<TConfig> {
			return {
				id: originalWorkflow.id,
				definitionName: originalWorkflow.definitionName,
				state: mutableState,
				data: { ...mutableData },
				createdAt: originalWorkflow.createdAt,
				updatedAt: new Date(),
			} as Workflow<TConfig>;
		},
	};

	return ctx as unknown as Context<TConfig, TDeps>;
}
