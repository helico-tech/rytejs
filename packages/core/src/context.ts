import type { WorkflowDefinition } from "./definition.js";
import type { ContextKey } from "./key.js";
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
import { wrapDeps as wrapDepsProxy } from "./wrap-deps.js";

/** Mutable context flowing through the middleware pipeline during dispatch. */
export interface Context<
	TConfig extends WorkflowConfig,
	TDeps,
	TState extends StateNames<TConfig> = StateNames<TConfig>,
	TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> {
	/** The command being dispatched, with type and validated payload. */
	readonly command: {
		readonly type: TCommand;
		readonly payload: CommandPayload<TConfig, TCommand>;
	};
	/** The original workflow before any mutations. */
	readonly workflow: WorkflowOf<TConfig, TState>;
	/** Dependencies injected via the router constructor. */
	readonly deps: TDeps;

	/** Current state data (reflects mutations from {@link update}). */
	readonly data: StateData<TConfig, TState>;
	/**
	 * Merges partial data into the current state. Validates against the state's Zod schema.
	 * @param data - Partial state data to merge
	 */
	update(data: Partial<StateData<TConfig, TState>>): void;

	/**
	 * Transitions the workflow to a new state with new data. Validates against the target state's Zod schema.
	 * @param target - Target state name
	 * @param data - Data for the target state
	 */
	transition<Target extends StateNames<TConfig>>(
		target: Target,
		data: StateData<TConfig, Target>,
	): void;

	/** Current state name (reflects mutations from {@link transition}). */
	readonly state: TState;

	/**
	 * Emits a domain event. Validates event data against the event's Zod schema.
	 * @param type - Event type name
	 * @param data - Event data matching the event's schema
	 */
	emit<E extends EventNames<TConfig>>(type: E, data: EventData<TConfig, E>): void;
	/** Accumulated events emitted during this dispatch. */
	readonly events: ReadonlyArray<{ type: EventNames<TConfig>; data: unknown }>;

	/**
	 * Signals a domain error. Validates error data and throws internally (caught by the router).
	 * @param code - Error code
	 * @param data - Error data matching the error code's schema
	 */
	error<C extends ErrorCodes<TConfig>>(code: C, data: ErrorData<TConfig, C>): never;

	/**
	 * Pattern-matches on the current state, calling the matching callback with narrowed data.
	 * All states must be handled (exhaustive).
	 */
	match<R>(
		matchers: {
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		},
	): R;
	/**
	 * Pattern-matches on the current state with a fallback for unhandled states.
	 */
	match<R>(
		matchers: Partial<{
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		}>,
		fallback: () => R,
	): R;

	/**
	 * Stores a value in context-scoped middleware state.
	 * @param key - A {@link ContextKey} created via {@link createKey}
	 * @param value - The value to store
	 */
	set<T>(key: ContextKey<T>, value: T): void;
	/**
	 * Retrieves a value from context-scoped middleware state. Throws if not set.
	 * @param key - A {@link ContextKey} created via {@link createKey}
	 */
	get<T>(key: ContextKey<T>): T;
	/**
	 * Retrieves a value from context-scoped middleware state, or `undefined` if not set.
	 * @param key - A {@link ContextKey} created via {@link createKey}
	 */
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
	options?: { wrapDeps?: boolean },
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
		deps:
			options?.wrapDeps !== false && deps != null && typeof deps === "object"
				? (wrapDepsProxy(deps as object) as TDeps)
				: deps,

		get state() {
			return mutableState;
		},

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
				throw new ValidationError("transition", [
					{
						code: "custom",
						message: `Unknown state: ${target}`,
						input: target,
						path: ["state"],
					},
				]);
			}
			const schema = definition.getStateSchema(target);
			const result = schema.safeParse(data);
			if (!result.success) {
				throw new ValidationError("transition", result.error.issues);
			}
			mutableState = target;
			mutableData = result.data as Record<string, unknown>;
		},

		emit(type: string, data: unknown) {
			const schema = definition.getEventSchema(type);
			const result = schema.safeParse(data);
			if (!result.success) {
				throw new ValidationError("event", result.error.issues);
			}
			accumulatedEvents.push({ type, data: result.data });
		},

		get events() {
			return [...accumulatedEvents];
		},

		error(code: string, data: unknown) {
			const schema = definition.getErrorSchema(code);
			const result = schema.safeParse(data);
			if (!result.success) {
				throw new ValidationError("state", result.error.issues);
			}
			throw new DomainErrorSignal(code, result.data);
		},

		match(
			matchers: Record<string, (data: unknown, workflow: unknown) => unknown>,
			fallback?: () => unknown,
		) {
			const matcher = matchers[originalWorkflow.state];
			if (matcher) return matcher(ctx.data, originalWorkflow);
			if (fallback) return fallback();
			throw new Error(`No matcher for state: ${originalWorkflow.state}`);
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
