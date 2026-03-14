import { compose } from "./compose.js";
import { type Context, createContext } from "./context.js";
import type { WorkflowDefinition } from "./definition.js";
import type { RouterGraph, TransitionInfo } from "./introspection.js";
import type {
	CommandNames,
	DispatchResult,
	ErrorCodes,
	ErrorData,
	StateNames,
	Workflow,
	WorkflowConfig,
} from "./types.js";
import { DomainErrorSignal, ValidationError } from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: internal type erasure for heterogeneous middleware storage
type AnyMiddleware = (ctx: any, next: () => Promise<void>) => Promise<void>;
// biome-ignore lint/suspicious/noExplicitAny: internal type erasure for heterogeneous handler storage
type AnyHandler = (ctx: any) => void | Promise<void>;

type HandlerEntry = {
	inlineMiddleware: AnyMiddleware[];
	handler: AnyMiddleware;
	targets?: string[];
};

class StateBuilder<TConfig extends WorkflowConfig, TDeps, TState extends StateNames<TConfig>> {
	/** @internal */ readonly middleware: AnyMiddleware[] = [];
	/** @internal */ readonly handlers = new Map<string, HandlerEntry>();

	on<C extends CommandNames<TConfig>>(
		command: C,
		options: { targets: readonly string[] },
		...fns: [...AnyMiddleware[], (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>]
	): this;
	on<C extends CommandNames<TConfig>>(
		command: C,
		...fns: [...AnyMiddleware[], (ctx: Context<TConfig, TDeps, TState, C>) => void | Promise<void>]
	): this;
	on(command: string, ...fns: unknown[]): this {
		// biome-ignore lint/suspicious/noExplicitAny: runtime type discrimination for options object
		const args = [...fns] as any[];
		let targets: string[] | undefined;
		if (
			args.length > 0 &&
			typeof args[0] === "object" &&
			args[0] !== null &&
			"targets" in args[0]
		) {
			targets = (args.shift() as { targets: string[] }).targets;
		}
		if (args.length === 0) throw new Error("on() requires at least a handler");
		const handler = args.pop() as AnyHandler;
		const inlineMiddleware = args as AnyMiddleware[];
		const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
			await handler(ctx);
		};
		this.handlers.set(command as string, { inlineMiddleware, handler: wrappedHandler, targets });
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

	constructor(
		private readonly definition: WorkflowDefinition<TConfig>,
		private readonly deps: TDeps = {} as TDeps,
	) {}

	/** Adds global middleware or merges another router's handlers. */
	use(
		middlewareOrRouter:
			| ((ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>)
			| WorkflowRouter<TConfig, TDeps>,
	): this {
		if (middlewareOrRouter instanceof WorkflowRouter) {
			this.merge(middlewareOrRouter);
		} else {
			this.globalMiddleware.push(middlewareOrRouter as AnyMiddleware);
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
					targets: entry.targets ? [...entry.targets] : undefined,
				});
			}
		}
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
						targets: entry.targets ? [...entry.targets] : undefined,
					});
				}
			}
			parentBuilder.middleware.push(...childBuilder.middleware);
		}
	}

	/** Registers handlers for one or more states. */
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

	/** Returns the transition graph built from registered handlers and their declared targets. */
	inspect(): RouterGraph<TConfig> {
		const transitions: TransitionInfo<TConfig>[] = [];
		const allStates = Object.keys(this.definition.config.states) as StateNames<TConfig>[];

		// Single-state handlers
		for (const [stateName, builder] of this.singleStateBuilders) {
			for (const [command, entry] of builder.handlers) {
				transitions.push({
					from: stateName as StateNames<TConfig>,
					command: command as CommandNames<TConfig>,
					to: (entry.targets ?? []) as StateNames<TConfig>[],
				});
			}
		}

		// Multi-state handlers
		for (const [stateName, builder] of this.multiStateBuilders) {
			for (const [command, entry] of builder.handlers) {
				const hasSingle = this.singleStateBuilders.get(stateName)?.handlers.has(command);
				if (!hasSingle) {
					transitions.push({
						from: stateName as StateNames<TConfig>,
						command: command as CommandNames<TConfig>,
						to: (entry.targets ?? []) as StateNames<TConfig>[],
					});
				}
			}
		}

		// Wildcard handlers — produce a transition for each state not already covered
		for (const [command, entry] of this.wildcardHandlers) {
			for (const stateName of allStates) {
				const hasSingle = this.singleStateBuilders.get(stateName)?.handlers.has(command);
				const hasMulti = this.multiStateBuilders.get(stateName)?.handlers.has(command);
				if (!hasSingle && !hasMulti) {
					transitions.push({
						from: stateName,
						command: command as CommandNames<TConfig>,
						to: (entry.targets ?? []) as StateNames<TConfig>[],
					});
				}
			}
		}

		return {
			definition: this.definition.inspect(),
			transitions,
		};
	}

	/** Registers a wildcard handler that matches any state. */
	on<C extends CommandNames<TConfig>>(
		_state: "*",
		command: C,
		options: { targets: readonly string[] },
		...fns: [
			...AnyMiddleware[],
			(ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
		]
	): this;
	on<C extends CommandNames<TConfig>>(
		_state: "*",
		command: C,
		...fns: [
			...AnyMiddleware[],
			(ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
		]
	): this;
	on(_state: "*", command: string, ...fns: unknown[]): this {
		// biome-ignore lint/suspicious/noExplicitAny: runtime type discrimination for options object
		const args = [...fns] as any[];
		let targets: string[] | undefined;
		if (
			args.length > 0 &&
			typeof args[0] === "object" &&
			args[0] !== null &&
			"targets" in args[0]
		) {
			targets = (args.shift() as { targets: string[] }).targets;
		}
		if (args.length === 0) throw new Error("on() requires at least a handler");
		const handler = args.pop() as AnyHandler;
		const inlineMiddleware = args as AnyMiddleware[];
		const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
			await handler(ctx);
		};
		this.wildcardHandlers.set(command as string, {
			inlineMiddleware,
			handler: wrappedHandler,
			targets,
		});
		return this;
	}

	/** Dispatches a command to the appropriate handler and returns the result. */
	async dispatch(
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
		);

		try {
			const composed = compose(chain);
			await composed(ctx);
			return {
				ok: true as const,
				workflow: ctx.getWorkflowSnapshot(),
				events: [...ctx.events],
			};
		} catch (err) {
			if (err instanceof DomainErrorSignal) {
				return {
					ok: false as const,
					error: {
						category: "domain" as const,
						code: err.code as ErrorCodes<TConfig>,
						data: err.data as ErrorData<TConfig, ErrorCodes<TConfig>>,
					},
				};
			}
			if (err instanceof ValidationError) {
				return {
					ok: false as const,
					error: {
						category: "validation" as const,
						source: err.source,
						issues: err.issues,
						message: err.message,
					},
				};
			}
			throw err;
		}
	}
}
