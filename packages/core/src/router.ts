import { compose } from "./compose.js";
import { type Context, createContext } from "./context.js";
import type { WorkflowDefinition } from "./definition.js";
import { HOOK_EVENTS, HookRegistry } from "./hooks.js";
import type { Plugin } from "./plugin.js";
import { isPlugin } from "./plugin.js";
import type { ReadonlyContext } from "./readonly-context.js";
import type {
	CommandNames,
	DispatchResult,
	ErrorCodes,
	ErrorData,
	EventNames,
	PipelineError,
	StateNames,
	Workflow,
	WorkflowConfig,
} from "./types.js";
import { DependencyErrorSignal, DomainErrorSignal, ValidationError } from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: internal type erasure for heterogeneous middleware storage
type AnyMiddleware = (ctx: any, next: () => Promise<void>) => Promise<void>;
// biome-ignore lint/suspicious/noExplicitAny: internal type erasure for heterogeneous handler storage
type AnyHandler = (ctx: any) => void | Promise<void>;

type HandlerEntry = {
	inlineMiddleware: AnyMiddleware[];
	handler: AnyMiddleware;
};

/** Options for the {@link WorkflowRouter} constructor. */
export interface RouterOptions {
	/** Callback invoked when a lifecycle hook throws. Defaults to `console.error`. */
	onHookError?: (error: unknown) => void;
	/** Wrap deps in a Proxy to catch dependency errors. Defaults to `true`. */
	wrapDeps?: boolean;
}

class StateBuilder<TConfig extends WorkflowConfig, TDeps, TState extends StateNames<TConfig>> {
	/** @internal */ readonly middleware: AnyMiddleware[] = [];
	/** @internal */ readonly handlers = new Map<string, HandlerEntry>();

	constructor() {
		this.on = this.on.bind(this);
		this.use = this.use.bind(this);
	}

	// Overload 1: handler only (no middleware) — covers 90% of usage
	on<C extends CommandNames<TConfig>>(
		command: C,
		handler: (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>,
	): this;
	// Overload 2: middleware + handler (variadic)
	on<C extends CommandNames<TConfig>>(
		command: C,
		...fns: [...AnyMiddleware[], (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>]
	): this;
	// Implementation
	on<C extends CommandNames<TConfig>>(
		command: C,
		...fns: [...AnyMiddleware[], (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>]
	): this {
		if (fns.length === 0) throw new Error("on() requires at least a handler");
		const handler = fns.pop() as AnyHandler;
		const inlineMiddleware = fns as AnyMiddleware[];
		const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
			await handler(ctx);
		};
		this.handlers.set(command as string, { inlineMiddleware, handler: wrappedHandler });
		return this;
	}

	use(
		middleware: (ctx: Context<TConfig, TDeps, TState>, next: () => Promise<void>) => Promise<void>,
	): this {
		this.middleware.push(middleware as AnyMiddleware);
		return this;
	}
}

/**
 * Routes commands to handlers based on workflow state.
 *
 * Supports global middleware, state-scoped middleware, inline middleware,
 * wildcard handlers, and multi-state handlers.
 */
// biome-ignore lint/complexity/noBannedTypes: {} is correct here — TDeps defaults to "no deps", inferred away when deps are provided
export class WorkflowRouter<TConfig extends WorkflowConfig, TDeps = {}> {
	private globalMiddleware: AnyMiddleware[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: type erasure — builders store handlers for different state types
	private singleStateBuilders = new Map<string, StateBuilder<TConfig, TDeps, any>>();
	// biome-ignore lint/suspicious/noExplicitAny: type erasure — builders store handlers for different state types
	private multiStateBuilders = new Map<string, StateBuilder<TConfig, TDeps, any>>();
	private wildcardHandlers = new Map<string, HandlerEntry>();
	private hookRegistry = new HookRegistry();
	private readonly onHookError: (error: unknown) => void;
	private readonly wrapDeps: boolean;

	/**
	 * @param definition - The workflow definition describing states, commands, events, and errors
	 * @param deps - Dependencies injected into every handler context
	 * @param options - Router configuration options
	 */
	constructor(
		readonly definition: WorkflowDefinition<TConfig>,
		private readonly deps: TDeps = {} as TDeps,
		options: RouterOptions = {},
	) {
		this.onHookError = options.onHookError ?? console.error;
		this.wrapDeps = options.wrapDeps !== false;
	}

	/**
	 * Adds global middleware, merges another router, or applies a plugin.
	 * @param arg - A middleware function, another {@link WorkflowRouter} to merge, or a {@link Plugin}
	 */
	use(
		arg:
			| ((ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>)
			| WorkflowRouter<TConfig, TDeps>
			| Plugin<TConfig, TDeps>,
	): this {
		if (arg instanceof WorkflowRouter) {
			this.merge(arg);
		} else if (isPlugin(arg)) {
			(arg as (router: WorkflowRouter<TConfig, TDeps>) => void)(this);
		} else {
			this.globalMiddleware.push(arg as AnyMiddleware);
		}
		return this;
	}

	private merge(child: WorkflowRouter<TConfig, TDeps>): void {
		if (child.definition !== this.definition) {
			throw new Error(
				`Cannot merge router for '${child.definition.name}' into router for '${this.definition.name}': definition mismatch`,
			);
		}

		this.globalMiddleware.push(...child.globalMiddleware);
		this.mergeStateBuilders(this.singleStateBuilders, child.singleStateBuilders);
		this.mergeStateBuilders(this.multiStateBuilders, child.multiStateBuilders);

		for (const [command, entry] of child.wildcardHandlers) {
			if (!this.wildcardHandlers.has(command)) {
				this.wildcardHandlers.set(command, {
					inlineMiddleware: [...entry.inlineMiddleware],
					handler: entry.handler,
				});
			}
		}

		this.hookRegistry.merge(child.hookRegistry);
	}

	private mergeStateBuilders(
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — builders store handlers for different state types
		target: Map<string, StateBuilder<TConfig, TDeps, any>>,
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — builders store handlers for different state types
		source: Map<string, StateBuilder<TConfig, TDeps, any>>,
	): void {
		for (const [stateName, childBuilder] of source) {
			let parentBuilder = target.get(stateName);
			if (!parentBuilder) {
				// biome-ignore lint/suspicious/noExplicitAny: type erasure — state name is dynamic at runtime
				parentBuilder = new StateBuilder<TConfig, TDeps, any>();
				target.set(stateName, parentBuilder);
			}
			for (const [command, entry] of childBuilder.handlers) {
				if (!parentBuilder.handlers.has(command)) {
					parentBuilder.handlers.set(command, {
						inlineMiddleware: [...entry.inlineMiddleware],
						handler: entry.handler,
					});
				}
			}
			parentBuilder.middleware.push(...childBuilder.middleware);
		}
	}

	/**
	 * Registers handlers for one or more states.
	 * @param name - A state name or array of state names to register handlers for
	 * @param setup - Callback that receives a state builder to register commands and middleware
	 */
	state<P extends StateNames<TConfig> | readonly StateNames<TConfig>[]>(
		name: P,
		setup: (
			state: StateBuilder<
				TConfig,
				TDeps,
				P extends readonly (infer S)[] ? S & StateNames<TConfig> : P & StateNames<TConfig>
			>,
		) => void,
	): this {
		const names = Array.isArray(name) ? name : [name];
		const isMulti = Array.isArray(name);
		const routerMap = isMulti ? this.multiStateBuilders : this.singleStateBuilders;

		for (const n of names as string[]) {
			let router = routerMap.get(n);
			if (!router) {
				// biome-ignore lint/suspicious/noExplicitAny: type erasure — state name is dynamic at runtime
				router = new StateBuilder<TConfig, TDeps, any>();
				routerMap.set(n, router);
			}
			// biome-ignore lint/suspicious/noExplicitAny: type erasure — setup callback expects a specific state type
			setup(router as any);
		}
		return this;
	}

	/**
	 * Registers a lifecycle hook callback.
	 * @param event - The lifecycle event name
	 * @param callback - The callback to invoke when the event fires
	 */
	on(
		event: "dispatch:start",
		callback: (
			workflow: Workflow<TConfig>,
			command: { type: CommandNames<TConfig>; payload: unknown },
		) => void | Promise<void>,
	): this;
	on(
		event: "dispatch:end",
		callback: (
			workflow: Workflow<TConfig>,
			command: { type: CommandNames<TConfig>; payload: unknown },
			result: DispatchResult<TConfig>,
		) => void | Promise<void>,
	): this;
	on(
		event: "pipeline:start",
		callback: (ctx: ReadonlyContext<TConfig, TDeps>) => void | Promise<void>,
	): this;
	on(
		event: "pipeline:end",
		callback: (
			ctx: ReadonlyContext<TConfig, TDeps>,
			result: DispatchResult<TConfig>,
		) => void | Promise<void>,
	): this;
	on(
		event: "transition",
		callback: (
			from: StateNames<TConfig>,
			to: StateNames<TConfig>,
			workflow: Workflow<TConfig>,
		) => void | Promise<void>,
	): this;
	on(
		event: "error",
		callback: (
			error: PipelineError<TConfig>,
			ctx: ReadonlyContext<TConfig, TDeps>,
		) => void | Promise<void>,
	): this;
	on(
		event: "event",
		callback: (
			event: { type: EventNames<TConfig>; data: unknown },
			workflow: Workflow<TConfig>,
		) => void | Promise<void>,
	): this;
	/**
	 * Registers a wildcard handler that matches any state.
	 * @param state - Must be `"*"` to match all states
	 * @param command - The command name to handle
	 * @param handler - The terminal handler
	 */
	on<C extends CommandNames<TConfig>>(
		state: "*",
		command: C,
		handler: (ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
	): this;
	/**
	 * Registers a wildcard handler that matches any state, with inline middleware.
	 * @param state - Must be `"*"` to match all states
	 * @param command - The command name to handle
	 * @param fns - Inline middleware followed by the terminal handler
	 */
	on<C extends CommandNames<TConfig>>(
		state: "*",
		command: C,
		...fns: [
			...AnyMiddleware[],
			(ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
		]
	): this;
	// biome-ignore lint/suspicious/noExplicitAny: implementation signature must be loose to handle all overloads
	on(...args: any[]): this {
		const first = args[0] as string;

		if (HOOK_EVENTS.has(first)) {
			// biome-ignore lint/complexity/noBannedTypes: callbacks have varying signatures per hook event
			this.hookRegistry.add(first, args[1] as Function);
			return this;
		}

		if (first === "*") {
			const command = args[1] as string;
			const fns = args.slice(2) as unknown[];
			if (fns.length === 0) throw new Error("on() requires at least a handler");
			const handler = fns.pop() as AnyHandler;
			const inlineMiddleware = fns as AnyMiddleware[];
			const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
				await handler(ctx);
			};
			this.wildcardHandlers.set(command, {
				inlineMiddleware,
				handler: wrappedHandler,
			});
			return this;
		}

		throw new Error(`Unknown event or state: ${first}`);
	}

	/**
	 * Dispatches a command to the appropriate handler and returns the result.
	 * @param workflow - The current workflow instance to dispatch against
	 * @param command - The command with its type and payload
	 * @returns A {@link DispatchResult} indicating success or failure with the updated workflow and events
	 */
	async dispatch(
		workflow: Workflow<TConfig>,
		command: { type: CommandNames<TConfig>; payload: unknown },
	): Promise<DispatchResult<TConfig>> {
		// Hook: dispatch:start (fires before any validation)
		await this.hookRegistry.emit("dispatch:start", this.onHookError, workflow, command);

		let result: DispatchResult<TConfig>;
		try {
			result = await this.executePipeline(workflow, command);
		} catch (err) {
			result = {
				ok: false as const,
				error: {
					category: "unexpected" as const,
					error: err,
					message: err instanceof Error ? err.message : String(err),
				},
			};
		} finally {
			// Hook: dispatch:end (guaranteed to fire if dispatch:start fired)
			// biome-ignore lint/style/noNonNullAssertion: result is always assigned — either by try or catch
			await this.hookRegistry.emit("dispatch:end", this.onHookError, workflow, command, result!);
		}
		return result;
	}

	private async executePipeline(
		workflow: Workflow<TConfig>,
		command: { type: CommandNames<TConfig>; payload: unknown },
	): Promise<DispatchResult<TConfig>> {
		if (!this.definition.hasState(workflow.state)) {
			return {
				ok: false,
				error: {
					category: "router",
					code: "UNKNOWN_STATE",
					message: `Unknown state: ${workflow.state}`,
				},
			};
		}

		const commandSchema = this.definition.getCommandSchema(command.type);
		const payloadResult = commandSchema.safeParse(command.payload);
		if (!payloadResult.success) {
			return {
				ok: false,
				error: {
					category: "validation",
					source: "command",
					issues: payloadResult.error.issues,
					message: `Invalid command payload: ${payloadResult.error.issues.map((i) => i.message).join(", ")}`,
				},
			};
		}
		const validatedCommand = { type: command.type, payload: payloadResult.data };

		const stateName = workflow.state;
		const singleRouter = this.singleStateBuilders.get(stateName);
		const multiRouter = this.multiStateBuilders.get(stateName);
		const singleHandler = singleRouter?.handlers.get(command.type);
		const multiHandler = multiRouter?.handlers.get(command.type);
		const wildcardHandler = this.wildcardHandlers.get(command.type);

		let routeEntry: HandlerEntry | undefined;
		// biome-ignore lint/suspicious/noExplicitAny: type erasure — matched router's state type is dynamic
		let matchedRouter: StateBuilder<TConfig, TDeps, any> | undefined;

		if (singleHandler) {
			routeEntry = singleHandler;
			matchedRouter = singleRouter;
		} else if (multiHandler) {
			routeEntry = multiHandler;
			matchedRouter = multiRouter;
		} else if (wildcardHandler) {
			routeEntry = wildcardHandler;
			matchedRouter = undefined;
		}

		if (!routeEntry) {
			return {
				ok: false,
				error: {
					category: "router",
					code: "NO_HANDLER",
					message: `No handler for command '${command.type}' in state '${stateName}'`,
				},
			};
		}

		const stateMiddleware: AnyMiddleware[] = [];
		if (matchedRouter) {
			if (singleRouter) stateMiddleware.push(...singleRouter.middleware);
			if (multiRouter && multiRouter !== singleRouter)
				stateMiddleware.push(...multiRouter.middleware);
		}

		const chain: AnyMiddleware[] = [
			...this.globalMiddleware,
			...stateMiddleware,
			...routeEntry.inlineMiddleware,
			routeEntry.handler,
		];

		const ctx = createContext<TConfig, TDeps>(
			this.definition,
			workflow,
			validatedCommand,
			this.deps,
			{ wrapDeps: this.wrapDeps },
		);

		// Hook: pipeline:start
		await this.hookRegistry.emit("pipeline:start", this.onHookError, ctx);

		try {
			const composed = compose(chain);
			await composed(ctx);
			const result: DispatchResult<TConfig> = {
				ok: true as const,
				workflow: ctx.getWorkflowSnapshot(),
				events: [...ctx.events],
			};

			// Hook: transition (if state changed)
			if (result.ok && result.workflow.state !== workflow.state) {
				await this.hookRegistry.emit(
					"transition",
					this.onHookError,
					workflow.state,
					result.workflow.state,
					result.workflow,
				);
			}

			// Hook: event (for each emitted event)
			if (result.ok) {
				for (const event of result.events) {
					await this.hookRegistry.emit("event", this.onHookError, event, result.workflow);
				}
			}

			// Hook: pipeline:end
			await this.hookRegistry.emit("pipeline:end", this.onHookError, ctx, result);

			return result;
		} catch (err) {
			let result: DispatchResult<TConfig>;
			if (err instanceof DomainErrorSignal) {
				result = {
					ok: false as const,
					error: {
						category: "domain" as const,
						code: err.code as ErrorCodes<TConfig>,
						data: err.data as ErrorData<TConfig, ErrorCodes<TConfig>>,
					},
				};
			} else if (err instanceof ValidationError) {
				result = {
					ok: false as const,
					error: {
						category: "validation" as const,
						source: err.source,
						issues: err.issues,
						message: err.message,
					},
				};
			} else if (err instanceof DependencyErrorSignal) {
				result = {
					ok: false as const,
					error: {
						category: "dependency" as const,
						name: err.depName,
						error: err.error,
						message: err.message,
					},
				};
			} else {
				result = {
					ok: false as const,
					error: {
						category: "unexpected" as const,
						error: err,
						message: err instanceof Error ? err.message : String(err),
					},
				};
			}

			// Hook: error
			await this.hookRegistry.emit("error", this.onHookError, result.error, ctx);

			// Hook: pipeline:end
			await this.hookRegistry.emit("pipeline:end", this.onHookError, ctx, result);

			return result;
		}
	}
}
