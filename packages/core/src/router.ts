import { compose } from "./compose.js";
import { type Context, createContext } from "./context.js";
import type { WorkflowDefinition } from "./definition.js";
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

type AnyMiddleware = (ctx: any, next: () => Promise<void>) => Promise<void>;
type AnyHandler = (ctx: any) => void | Promise<void>;

type HandlerEntry = { inlineMiddleware: AnyMiddleware[]; handler: AnyMiddleware };

class StateBuilder<TConfig extends WorkflowConfig, TDeps, TState extends StateNames<TConfig>> {
	/** @internal */ readonly middleware: AnyMiddleware[] = [];
	/** @internal */ readonly handlers = new Map<string, HandlerEntry>();

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
export class WorkflowRouter<TConfig extends WorkflowConfig, TDeps = {}> {
	private globalMiddleware: AnyMiddleware[] = [];
	private singleStateBuilders = new Map<string, StateBuilder<TConfig, TDeps, any>>();
	private multiStateBuilders = new Map<string, StateBuilder<TConfig, TDeps, any>>();
	private wildcardHandlers = new Map<string, HandlerEntry>();

	constructor(
		private readonly definition: WorkflowDefinition<TConfig>,
		private readonly deps: TDeps = {} as TDeps,
	) {}

	/** Adds global middleware that wraps all dispatches. */
	use(
		middleware: (ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>,
	): this {
		this.globalMiddleware.push(middleware as AnyMiddleware);
		return this;
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
				router = new StateBuilder<TConfig, TDeps, any>();
				routerMap.set(n, router);
			}
			setup(router as any);
		}
		return this;
	}

	/** Registers a wildcard handler that matches any state. */
	on<C extends CommandNames<TConfig>>(
		_state: "*",
		command: C,
		...fns: [
			...AnyMiddleware[],
			(ctx: Context<TConfig, TDeps, StateNames<TConfig>, C>) => void | Promise<void>,
		]
	): this {
		if (fns.length === 0) throw new Error("on() requires at least a handler");
		const handler = fns.pop() as AnyHandler;
		const inlineMiddleware = fns as AnyMiddleware[];
		const wrappedHandler: AnyMiddleware = async (ctx, _next) => {
			await handler(ctx);
		};
		this.wildcardHandlers.set(command as string, {
			inlineMiddleware,
			handler: wrappedHandler,
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
