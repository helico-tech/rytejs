# API Reference

Complete reference for all exports from `@rytejs/core`.

## Functions

### `defineWorkflow(name, config)`

Creates a workflow definition from a name and Zod schema configuration.

```ts
function defineWorkflow<const TConfig extends WorkflowConfig>(
  name: string,
  config: TConfig,
): WorkflowDefinition<TConfig>
```

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `name` | `string` | Unique name for this workflow type |
| `config` | `TConfig` | Object with `states`, `commands`, `events`, `errors` -- each a record of Zod schemas |

Returns a `WorkflowDefinition` with methods for creating instances and accessing schemas.

---

### `createKey(name)`

Creates a phantom-typed key for type-safe context storage.

```ts
function createKey<T>(name: string): ContextKey<T>
```

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `name` | `string` | Debug label (uniqueness comes from internal `Symbol`) |

Returns a `ContextKey<T>` used with `ctx.set()`, `ctx.get()`, and `ctx.getOrNull()`.

---

## Classes

### `WorkflowRouter<TConfig, TDeps>`

Routes commands to handlers based on workflow state.

```ts
class WorkflowRouter<TConfig extends WorkflowConfig, TDeps = {}>
```

#### Constructor

```ts
new WorkflowRouter(definition: WorkflowDefinition<TConfig>, deps?: TDeps)
```

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `definition` | `WorkflowDefinition<TConfig>` | Workflow definition created by `defineWorkflow()` |
| `deps` | `TDeps` | Optional dependencies object, accessible via `ctx.deps` |

#### Methods

##### `.use(middleware)`

Adds global middleware that wraps all dispatches.

```ts
use(middleware: (ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>): this
```

##### `.state(name, setup)`

Registers handlers for one or more states.

```ts
// Single state
state<S extends StateNames<TConfig>>(
  name: S,
  setup: (state: StateBuilder<TConfig, TDeps, S>) => void,
): this

// Multiple states
state<S extends readonly StateNames<TConfig>[]>(
  name: S,
  setup: (state: StateBuilder<TConfig, TDeps, S[number]>) => void,
): this
```

The `setup` callback receives a `StateBuilder` with:
- `.on(command, ...middleware?, handler)` -- register a handler with optional inline middleware
- `.use(middleware)` -- add state-scoped middleware

##### `.on("*", command, ...middleware?, handler)`

Registers a wildcard handler that matches any state.

```ts
on<C extends CommandNames<TConfig>>(
  _state: "*",
  command: C,
  ...fns: [...Middleware[], Handler],
): this
```

##### `.dispatch(workflow, command)`

Dispatches a command to the appropriate handler.

```ts
async dispatch(
  workflow: Workflow<TConfig>,
  command: { type: CommandNames<TConfig>; payload: unknown },
): Promise<DispatchResult<TConfig>>
```

---

### `ValidationError`

Thrown internally when Zod validation fails during dispatch. Caught by the router and returned as a validation error in `DispatchResult`.

```ts
class ValidationError extends Error {
  readonly source: "command" | "state" | "event" | "transition";
  readonly issues: z.core.$ZodIssue[];
}
```

---

### `DomainErrorSignal`

Thrown internally when a handler calls `ctx.error()`. Caught by the router and returned as a domain error in `DispatchResult`.

```ts
class DomainErrorSignal extends Error {
  readonly code: string;
  readonly data: unknown;
}
```

---

## Types

### Configuration & Definition

#### `WorkflowConfig`

Shape of the configuration object passed to `defineWorkflow()`.

```ts
interface WorkflowConfig {
  states: Record<string, ZodType>;
  commands: Record<string, ZodType>;
  events: Record<string, ZodType>;
  errors: Record<string, ZodType>;
}
```

#### `WorkflowDefinition<TConfig>`

Returned by `defineWorkflow()`. Provides workflow creation and schema access.

```ts
interface WorkflowDefinition<TConfig extends WorkflowConfig> {
  readonly config: TConfig;
  readonly name: string;
  createWorkflow<S extends StateNames<TConfig>>(
    id: string,
    config: { initialState: S; data: z.infer<TConfig["states"][S]> },
  ): WorkflowOf<TConfig, S>;
  getStateSchema(stateName: string): ZodType;
  getCommandSchema(commandName: string): ZodType;
  getEventSchema(eventName: string): ZodType;
  getErrorSchema(errorCode: string): ZodType;
  hasState(stateName: string): boolean;
}
```

### Workflow Types

#### `Workflow<TConfig>`

Discriminated union of all possible workflow states. Checking `.state` narrows `.data`.

```ts
type Workflow<TConfig extends WorkflowConfig> = {
  [S in StateNames<TConfig>]: WorkflowOf<TConfig, S>;
}[StateNames<TConfig>];
```

#### `WorkflowOf<TConfig, S>`

A workflow narrowed to a specific state.

```ts
interface WorkflowOf<TConfig extends WorkflowConfig, S extends StateNames<TConfig>> {
  readonly id: string;
  readonly definitionName: string;
  readonly state: S;
  readonly data: StateData<TConfig, S>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

### Context

#### `Context<TConfig, TDeps, TState, TCommand>`

Mutable context flowing through the middleware pipeline during dispatch.

```ts
interface Context<TConfig, TDeps, TState, TCommand> {
  readonly command: { readonly type: TCommand; readonly payload: CommandPayload<TConfig, TCommand> };
  readonly workflow: WorkflowOf<TConfig, TState>;
  readonly deps: TDeps;
  readonly data: StateData<TConfig, TState>;
  readonly events: ReadonlyArray<{ type: EventNames<TConfig>; data: unknown }>;

  update(data: Partial<StateData<TConfig, TState>>): void;
  transition<Target extends StateNames<TConfig>>(target: Target, data: StateData<TConfig, Target>): void;
  emit<E extends EventNames<TConfig>>(event: { type: E; data: EventData<TConfig, E> }): void;
  error<C extends ErrorCodes<TConfig>>(err: { code: C; data: ErrorData<TConfig, C> }): never;

  set<T>(key: ContextKey<T>, value: T): void;
  get<T>(key: ContextKey<T>): T;
  getOrNull<T>(key: ContextKey<T>): T | undefined;
}
```

#### `ContextKey<T>`

Phantom-typed key for type-safe context storage.

```ts
interface ContextKey<T> {
  readonly _phantom: T;
  readonly id: symbol;
}
```

### Handlers & Middleware

#### `Middleware<TConfig, TDeps, TState?, TCommand?>`

Koa-style middleware function. State and command default to union of all possibilities.

```ts
type Middleware<TConfig, TDeps, TState, TCommand> = (
  ctx: Context<TConfig, TDeps, TState, TCommand>,
  next: () => Promise<void>,
) => Promise<void>;
```

#### `Handler<TConfig, TDeps, TState, TCommand>`

Terminal handler function. Does not receive `next`.

```ts
type Handler<TConfig, TDeps, TState, TCommand> = (
  ctx: Context<TConfig, TDeps, TState, TCommand>,
) => void | Promise<void>;
```

### Results & Errors

#### `DispatchResult<TConfig>`

Return type of `router.dispatch()`. Discriminated union on `ok`.

```ts
type DispatchResult<TConfig> =
  | { ok: true; workflow: Workflow<TConfig>; events: Array<{ type: EventNames<TConfig>; data: unknown }> }
  | { ok: false; error: PipelineError<TConfig> };
```

#### `PipelineError<TConfig>`

Discriminated union of all error types on `category`.

```ts
type PipelineError<TConfig> =
  | { category: "validation"; source: "command" | "state" | "event" | "transition"; issues: z.core.$ZodIssue[]; message: string }
  | { category: "domain"; code: ErrorCodes<TConfig>; data: ErrorData<TConfig, ErrorCodes<TConfig>> }
  | { category: "router"; code: "NO_HANDLER" | "UNKNOWN_STATE"; message: string };
```

### Utility Types

#### `StateNames<TConfig>`

Extracts state name strings from a workflow config.

```ts
type StateNames<T extends WorkflowConfig> = keyof T["states"] & string;
```

#### `CommandNames<TConfig>`

Extracts command name strings from a workflow config.

```ts
type CommandNames<T extends WorkflowConfig> = keyof T["commands"] & string;
```

#### `EventNames<TConfig>`

Extracts event name strings from a workflow config.

```ts
type EventNames<T extends WorkflowConfig> = keyof T["events"] & string;
```

#### `ErrorCodes<TConfig>`

Extracts error code strings from a workflow config.

```ts
type ErrorCodes<T extends WorkflowConfig> = keyof T["errors"] & string;
```

#### `StateData<TConfig, S>`

Infers the data type for a given state.

```ts
type StateData<T extends WorkflowConfig, S extends StateNames<T>> =
  T["states"][S] extends ZodType ? z.infer<T["states"][S]> : never;
```

#### `CommandPayload<TConfig, C>`

Infers the payload type for a given command.

```ts
type CommandPayload<T extends WorkflowConfig, C extends CommandNames<T>> =
  T["commands"][C] extends ZodType ? z.infer<T["commands"][C]> : never;
```

#### `EventData<TConfig, E>`

Infers the data type for a given event.

```ts
type EventData<T extends WorkflowConfig, E extends EventNames<T>> =
  T["events"][E] extends ZodType ? z.infer<T["events"][E]> : never;
```

#### `ErrorData<TConfig, C>`

Infers the data type for a given error code.

```ts
type ErrorData<T extends WorkflowConfig, C extends ErrorCodes<T>> =
  T["errors"][C] extends ZodType ? z.infer<T["errors"][C]> : never;
```
