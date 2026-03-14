# @ryte/core — Design Specification

**Date:** 2026-03-14
**Status:** Approved
**Package:** `@ryte/core`
**License:** MIT

## Overview

Ryte is a type-safe workflow engine for TypeScript. It implements a stateful command-dispatch pipeline with Zod schema validation, Koa-style middleware composition, dependency injection, and event emission. It is a faithful reimplementation of the internal `workflow` engine, packaged for public consumption as `@ryte/core`.

The engine is a pure dispatch function: command in, middleware pipeline, workflow state out. It has no opinions on persistence, scheduling, or orchestration — those are consumer concerns.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Schema library | Zod (peer dep, v4 only) | Dominant TS validation lib, excellent type inference. v3→v4 has breaking API changes — supporting both adds complexity with no clear benefit |
| Runtime targets | Node.js + Bun + Deno | Pure logic, no platform APIs — runs everywhere |
| Package scope | `@ryte/core` (under `@ryte` org) | Room for future packages (`@ryte/persist`, etc.) |
| Docs site | VitePress | De facto standard for JS/TS library docs |
| Test runner | Vitest | Modern, native TS/ESM, Jest-compatible API |
| Build tool | tsup | Dual CJS/ESM + .d.ts in one command |
| Monorepo | Turborepo + pnpm workspaces | Ready for multi-package growth |
| Formatter/linter | Biome | Fast, single tool, consistent formatting |
| Git hooks | Husky + lint-staged | Pre-commit: format/lint. Pre-push: typecheck + test |
| API approach | Faithful reimplementation | Original API is well-designed, no changes needed |
| License | MIT | Standard for NPM packages, zero adoption friction |

## Repository Structure

```
ryte/
├── packages/
│   └── core/                        # @ryte/core
│       ├── src/
│       │   ├── index.ts             # Public API exports
│       │   ├── types.ts             # Core type system
│       │   ├── definition.ts        # defineWorkflow() factory
│       │   ├── context.ts           # Context implementation
│       │   ├── middleware.ts        # Middleware type
│       │   ├── handler.ts           # Handler type
│       │   ├── router.ts            # WorkflowRouter + StateBuilder
│       │   ├── compose.ts           # Middleware composition
│       │   └── key.ts               # Typed context keys
│       ├── __tests__/
│       │   ├── types.test.ts
│       │   ├── definition.test.ts
│       │   ├── context.test.ts
│       │   ├── compose.test.ts
│       │   ├── router.test.ts
│       │   ├── key.test.ts
│       │   └── integration/
│       │       ├── order-fulfillment.test.ts
│       │       └── content-publishing.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── tsup.config.ts
├── docs/                            # VitePress site
│   ├── .vitepress/config.ts
│   ├── index.md
│   ├── guide/
│   │   ├── getting-started.md
│   │   ├── concepts.md
│   │   ├── defining-workflows.md
│   │   ├── routing-commands.md
│   │   ├── state-transitions.md
│   │   ├── middleware.md
│   │   ├── error-handling.md
│   │   ├── events.md
│   │   ├── dependency-injection.md
│   │   └── context-keys.md
│   ├── api/
│   │   └── index.md
│   └── examples/
│       ├── basic-workflow.md
│       └── real-world.md
├── examples/
│   └── basic/
│       ├── index.ts
│       └── package.json
├── .github/
│   └── workflows/
│       └── ci.yml
├── package.json                     # Workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .npmrc
├── .gitignore
├── LICENSE
├── PUBLISHING.md
└── README.md
```

## Public API Surface

### defineWorkflow

```typescript
function defineWorkflow<TConfig extends WorkflowConfig>(
  name: string,
  config: TConfig
): WorkflowDefinition<TConfig>
```

Creates a workflow definition from a name and a config object containing Zod schemas for states, commands, events, and errors.

**WorkflowDefinition methods and properties:**
- `readonly config: TConfig` — raw config for introspection of schemas
- `createWorkflow(id, { initialState, data })` — creates a workflow instance, validates data against the initial state schema
- `getStateSchema(name)` — returns the Zod schema for a state
- `getCommandSchema(name)` — returns the Zod schema for a command
- `getEventSchema(name)` — returns the Zod schema for an event
- `getErrorSchema(code)` — returns the Zod schema for an error
- `hasState(name)` — returns boolean, checks if a state exists in the config

### WorkflowRouter

```typescript
class WorkflowRouter<TConfig, TDeps = {}> {
  constructor(definition: WorkflowDefinition<TConfig>, deps?: TDeps)
  use(middleware: Middleware<TConfig, TDeps>): this
  state<S extends StateNames<TConfig>>(
    name: S | S[],
    setup: (builder: StateBuilder<TConfig, TDeps, S>) => void
  ): this
  on<C extends CommandNames<TConfig>>(
    wildcard: "*",
    command: C,
    handler: Handler<TConfig, TDeps, StateNames<TConfig>, C>
  ): this
  dispatch(
    workflow: Workflow<TConfig>,
    command: { type: CommandNames<TConfig>; payload: unknown }
  ): Promise<DispatchResult<TConfig>>
}
```

### StateBuilder

```typescript
interface StateBuilder<TConfig, TDeps, TState> {
  on<C extends CommandNames<TConfig>>(
    command: C,
    ...args: [...Middleware<TConfig, TDeps>[], Handler<TConfig, TDeps, TState, C>]
  ): this
  use(middleware: Middleware<TConfig, TDeps>): this
}
```

### Context

```typescript
interface Context<TConfig, TDeps, TState, TCommand> {
  readonly command: { type: TCommand; payload: CommandPayload<TConfig, TCommand> }
  readonly workflow: WorkflowOf<TConfig, TState>
  readonly deps: TDeps
  readonly data: StateData<TConfig, TState>
  readonly events: ReadonlyArray<Event>
  update(data: Partial<StateData<TConfig, TState>>): void
  transition<S extends StateNames<TConfig>>(state: S, data: StateData<TConfig, S>): void
  emit<E extends EventNames<TConfig>>(event: { type: E; data: EventData<TConfig, E> }): void
  error<C extends ErrorCodes<TConfig>>(error: { code: C; data: ErrorData<TConfig, C> }): never
  set<T>(key: ContextKey<T>, value: T): void
  get<T>(key: ContextKey<T>): T
  getOrNull<T>(key: ContextKey<T>): T | undefined
}
```

### Middleware Type

Defined in `middleware.ts`. Fully typed context with narrowing via defaults — same pattern as `Context`.

```typescript
type Middleware<
  TConfig extends WorkflowConfig,
  TDeps,
  TState extends StateNames<TConfig> = StateNames<TConfig>,
  TCommand extends CommandNames<TConfig> = CommandNames<TConfig>,
> = (
  ctx: Context<TConfig, TDeps, TState, TCommand>,
  next: () => Promise<void>
) => Promise<void>
```

- Global middleware: `Middleware<TConfig, TDeps>` — context has union of all states/commands
- State-scoped: `Middleware<TConfig, TDeps, "draft">` — narrowed to specific state
- Inline: `Middleware<TConfig, TDeps, "draft", "publish">` — fully narrowed

### Handler Type

Defined in `handler.ts`. A handler is terminal middleware — same typed context, no `next`.

```typescript
type Handler<
  TConfig extends WorkflowConfig,
  TDeps,
  TState extends StateNames<TConfig>,
  TCommand extends CommandNames<TConfig>
> = (ctx: Context<TConfig, TDeps, TState, TCommand>) => Promise<void> | void
```

Both are exported for consumers who want to type their middleware/handler variables.

`StateBuilder` is **not exported** from the barrel — consumers only interact with it via the callback parameter in `router.state()`.

`createContext` is **internal only** — used in tests but not part of the public API.

### Error Classes

```typescript
class ValidationError extends Error {
  constructor(
    source: "command" | "state" | "event" | "transition",
    issues: ZodIssue[]
  )
}

class DomainErrorSignal extends Error {
  constructor(code: string, data: unknown)
}
```

Both are exported as runtime values. Consumers need them for `instanceof` checks in error handling.

### createKey

```typescript
function createKey<T>(name: string): ContextKey<T>
```

Creates a typed key for storing/retrieving values in context middleware state.

### Type Utilities

```typescript
type StateNames<T>       // Union of state name string literals
type CommandNames<T>     // Union of command name string literals
type EventNames<T>       // Union of event name string literals
type ErrorCodes<T>       // Union of error code string literals
type StateData<T, S>     // Inferred data type for state S
type CommandPayload<T, C> // Inferred payload type for command C
type EventData<T, E>     // Inferred data type for event E
type ErrorData<T, C>     // Inferred data type for error code C
type Workflow<T>         // Discriminated union of all workflow states
type WorkflowOf<T, S>    // Workflow narrowed to specific state S
```

### Error Types

```typescript
type PipelineError<TConfig extends WorkflowConfig = WorkflowConfig> =
  | { category: "validation"; source: "command" | "state" | "event" | "transition"; issues: ZodIssue[]; message: string }
  | { category: "domain"; code: ErrorCodes<TConfig>; data: ErrorData<TConfig, ErrorCodes<TConfig>> }
  | { category: "router"; code: "NO_HANDLER" | "UNKNOWN_STATE"; message: string }

type DispatchResult<TConfig extends WorkflowConfig = WorkflowConfig> =
  | { ok: true; workflow: Workflow<TConfig>; events: Event[] }
  | { ok: false; error: PipelineError<TConfig> }
```

## Dependency Graph

```
types.ts        ← no internal imports
key.ts          ← no internal imports
compose.ts      ← no internal imports
definition.ts   ← imports types.ts
context.ts      ← imports types.ts, key.ts, definition.ts
middleware.ts   ← imports types.ts, context.ts
handler.ts      ← imports types.ts, context.ts
router.ts       ← imports types.ts, context.ts, definition.ts, compose.ts, middleware.ts, handler.ts
index.ts        ← re-exports from all of the above
```

No circular dependencies. Each file imports only from files above it in this list.

## Build & Package Configuration

### @ryte/core package.json

```jsonc
{
  "name": "@ryte/core",
  "version": "0.1.0",
  "description": "Type-safe workflow engine with Zod validation and middleware pipelines",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "sideEffects": false,
  "repository": {
    "type": "git",
    "url": "https://github.com/<org>/ryte",
    "directory": "packages/core"
  },
  "homepage": "https://<org>.github.io/ryte",
  "bugs": "https://github.com/<org>/ryte/issues",
  "keywords": ["workflow", "state-machine", "typescript", "zod", "middleware"],
  "peerDependencies": {
    "zod": "^4.0.0"
  },
  "engines": { "node": ">=18" }
}
```

### tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

### tsconfig.base.json

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

### turbo.json

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {},
    "typecheck": {},
    "lint": {}
  }
}
```

## Testing Strategy

### Unit Tests

Mirror source 1:1. Ported from bun:test to Vitest (near-identical API).

| File | Covers |
|---|---|
| `types.test.ts` | Type extraction utilities, error classes |
| `definition.test.ts` | defineWorkflow, createWorkflow, schema validation, schema accessors |
| `context.test.ts` | update, transition, emit, error, get/set/getOrNull, snapshots, deps |
| `compose.test.ts` | Middleware composition ordering, multiple next() guard, error propagation |
| `router.test.ts` | Dispatch, routing priority (single > multi > wildcard), middleware chain, rollback, async |
| `key.test.ts` | createKey, uniqueness, Map usage |

### Integration Tests

Full workflow lifecycle tests with realistic business scenarios.

**order-fulfillment.test.ts:**
- States: created → paid → shipped → delivered (+ cancelled)
- Multi-step dispatch sequence through full lifecycle
- Middleware (auth) + handlers + events + error recovery
- Verifies rollback on failed dispatch, then successful continuation

**content-publishing.test.ts:**
- States: draft → review → published/rejected
- Review workflow with approval/rejection paths
- Dependency injection (review service)
- Event accumulation across multiple dispatches

### What Integration Tests Verify

- Full workflow lifecycle across 4-5 states
- Middleware + handlers interacting in realistic pipeline
- Error recovery: domain error → rollback → successful retry
- Event accumulation per dispatch (no cross-dispatch leaking)
- Dependency injection used in handler logic

## Code Quality & Git Hooks

### Biome

- Formatter: tabs, 100-char line width
- Linter: recommended rules
- Import organization: automatic

### Husky + lint-staged

**Pre-commit:**
- lint-staged runs `biome check --no-errors-on-unmatched` on staged `.ts` files
- Auto-fixes formatting

**Pre-push:**
- Runs `turbo run typecheck test`
- Blocks push if types or tests fail

### Root Scripts

```jsonc
{
  "format": "biome format .",
  "format:fix": "biome format --fix .",
  "lint": "biome check .",
  "lint:fix": "biome check --fix .",
  "typecheck": "turbo run typecheck",
  "test": "turbo run test",
  "check": "turbo run typecheck test lint"
}
```

## Documentation Site (VitePress)

### Content Structure

| Page | Purpose |
|---|---|
| **Getting Started** | Install + first workflow in <2 minutes |
| **Concepts** | Mental model: how workflows, states, commands, events fit together |
| **Defining Workflows** | defineWorkflow + Zod schemas |
| **Routing Commands** | WorkflowRouter, StateBuilder, dispatch |
| **State Transitions** | update, transition, data flow |
| **Middleware** | Global, state, inline — onion model |
| **Error Handling** | Validation, domain, router errors + rollback |
| **Events** | Emitting and consuming |
| **Dependency Injection** | Injecting deps, typed access |
| **Context Keys** | createKey, typed middleware state |
| **API Reference** | Every exported function, class, type |
| **Basic Workflow** | Simple 3-state walkthrough |
| **Real World** | Complete order fulfillment example |

### Principles

- Getting Started gets you running in under 2 minutes
- Concepts page is the single mental model page with a diagram
- Each guide page covers one concept, short and focused
- API reference is exhaustive with signatures and descriptions
- No filler text

## Publishing

### NPM

1. Register `@ryte` org on npmjs.com
2. `pnpm --filter @ryte/core build`
3. `pnpm --filter @ryte/core publish --access public`
4. `git tag v0.1.0 && git push --tags`

Step-by-step instructions in `PUBLISHING.md`.

### GitHub Actions CI

```yaml
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup pnpm + node
      - pnpm install
      - turbo run typecheck test lint
```

### Not Included (v1)

- No automated release tooling (changesets, semantic-release)
- No automated NPM publish from CI
- Can be added later when release cadence warrants it
