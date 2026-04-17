# CLAUDE.md

## Project

@rytejs — type-safe workflow engine for TypeScript. Monorepo with `packages/core` and `packages/testing`.

## Commands

Use `pnpm` for all commands.

```bash
# Full check (workspace-level, uses turbo)
pnpm run check                            # typecheck + test + lint

# Per-package (use --filter from workspace root)
pnpm --filter @rytejs/core vitest run     # 257 tests (includes Valibot + ArkType interop)
pnpm --filter @rytejs/testing vitest run  # 31 tests
pnpm --filter @rytejs/core tsc --noEmit   # typecheck
pnpm --filter @rytejs/core tsup           # build dist (REQUIRED before testing package tests)
pnpm --filter @rytejs/docs typecheck     # typecheck doc snippets

# Lint
pnpm biome check .                        # check
pnpm biome check --fix .                  # autofix
```

## Architecture

- **Command dispatch pattern**: `router.dispatch(workflow, type, payload)` returns `DispatchResult` (never throws). Handlers use `emit(type, data)` and `error(code, data)` — all positional args.
- **Koa-style middleware**: global → state-scoped → inline → handler (onion model)
- **Discriminated unions**: `DispatchResult` on `ok`, `PipelineError` on `category`, `Workflow` on `state`
- **Standard Schema-driven types**: type inference flows from any Standard Schema v1 validator (Zod v4, Valibot, ArkType). Runtime validation uses the `["~standard"].validate()` protocol — no validator-specific APIs in router/context/definition.
- **Result pattern everywhere**: `dispatch()`, `restore()`, `migrate()` all return `{ ok: true, ... } | { ok: false, error }`
- **IO / Domain / IO**: handlers are pure (no IO). Reads via `deps`, writes via events processed after dispatch

## Code Style

- **Tabs**, 100-char line width (Biome enforces)
- **ES modules** with `.js` extensions on relative imports
- States, commands, events, errors: **PascalCase** (`Draft`, `PlaceOrder`, `OrderPlaced`, `OutOfStock`)
- `import type { T }` for type-only imports
- Organize imports via Biome (auto-sorted)

## CRITICAL Rules

- **NEVER use `any` in consumer-facing types.** Internal `any` is OK with a `biome-ignore` comment explaining why. Use `unknown` or proper generics instead.
- **StateBuilder methods are bound in the constructor.** `on` and `use` are regular methods (for better IDE generic inference) with `this.on = this.on.bind(this)` in the constructor, so `({ on, use }) =>` destructuring still works.
- **dispatch() never throws.** All errors (including unexpected handler errors) are caught and returned as `{ ok: false, error: { category: "unexpected" } }`. The `dispatch:end` hook MUST always fire if `dispatch:start` fired.
- **Build core before running testing package tests.** The testing package imports from `@rytejs/core` dist, not source. Run `cd packages/core && npx tsup` after changing core source.
- **Git push after every task.** Don't batch pushes.
- **npm org is `@rytejs`** (not `@ryte` — that was taken).

## Documentation Rules

- All handler examples use **destructured context**: `({ data, transition, emit }) =>` not `(ctx) =>`
- All state builder examples use **destructured state**: `({ on, use }) =>` not `(state) =>`
- Code blocks in docs use **tab indentation**
- Every code example must be **verifiable against the actual API** — check imports exist in `packages/core/src/index.ts`
- **Never reference removed features**: `inspect()`, `targets`, `@rytejs/viz`, `DefinitionInfo`, `RouterGraph`, `TransitionInfo`
- When documenting `PipelineError` categories, include ALL FIVE: `"validation"`, `"domain"`, `"router"`, `"unexpected"`, `"dependency"`
- `ValidationError.source` includes `"restore"` (from `definition.restore()`, not from `dispatch()`)
- New code examples go in `docs/snippets/` as compilable TypeScript with `#region` markers, referenced from markdown via `<<< @/snippets/...#region` — not inline
- Partial fragments that can't compile standalone (e.g., `errors: { ... }`) stay inline in markdown
- Snippet files use tab indentation per project style

## Testing

- Vitest with `describe`, `test`, `expect`
- Test files in `__tests__/` directories, colocated with source
- Use `@rytejs/testing` utilities: `createTestWorkflow`, `expectOk`, `expectError`, `testPath`, `createTestDeps`
- Zod v4 is required (peer dep) — only because `defineGroup` types against `z.ZodObject` and calls `.merge()` at runtime. All other features (router/context/dispatch/server fields) are validator-agnostic.

## Supported validators

Any validator that implements Standard Schema v1 works for state/command/event/error schemas: **Zod v4**, **Valibot**, **ArkType** (all three covered by `packages/core/__tests__/validators.test.ts`).

- **Server-only fields** are declared as a top-level list on `state({ schema, server: [...] })` — **validator-agnostic**. Runtime stripping is a key filter; client types use `Omit`. No schema introspection involved. See `docs/guide/server-fields.md`.
- **`forClient().deserialize()` does not re-validate** the data shape. Snapshots come from a trusted server (already validated + stripped). Callers wanting defence-in-depth should validate with their own client schema before calling `deserialize`.
- **`defineGroup`** currently requires Zod (uses `.merge()` for base/child composition). Non-Zod users can still build equivalent state maps manually — this is an opt-in helper, not a core primitive.
- `ValidationError.issues` and `PipelineError.issues` are typed as `readonly StandardSchemaV1.Issue[]` — validator-agnostic `{ message, path? }` shape. Don't cast to `ZodIssue[]`; use Standard Schema fields only.

## Package Structure

```
packages/core/          # @rytejs/core — workflow engine
packages/testing/       # @rytejs/testing — test utilities (peer dep on core)
docs/                   # VitePress documentation site
examples/               # Standalone examples (NOT in workspace)
tests/e2e/              # E2E tests (NOT in workspace, installs from npm)
```

## When Modifying

- After adding exports to core: update `packages/core/src/index.ts`, rebuild dist, update `docs/api/`
- After adding features: update relevant guide in `docs/guide/`, add to sidebar in `docs/.vitepress/config.ts`
- After changing public types: verify `@rytejs/testing` still compiles (rebuild core first)
- TypeScript overloads with `StateNames<TConfig>[]` in signatures need `string[]` instead — TS can't infer literal arrays without `as const`
- After changing core exports or types: run `pnpm --filter @rytejs/docs typecheck` to verify doc snippets

## Common Mistakes to Avoid

These are errors that have actually happened in this codebase. Read before writing code.

### TypeScript generics
- **Always add `<TConfig extends WorkflowConfig>` to functions that accept `MigrationPipeline`, `WorkflowDefinition`, or `WorkflowSnapshot`.** Without it, specific config types (e.g., `{ modelVersion: 3, states: {...} }`) won't be assignable to the base `WorkflowConfig`. This mistake was made 3 times.

### Stale dist
- **Rebuild core (`cd packages/core && npx tsup`) after ANY change to core source.** The `@rytejs/testing` package and integration tests import from `dist/`, not source. Forgetting this causes "X is not a function" errors that look like bugs but are just stale builds. This happened repeatedly.

### Documentation ahead of code
- **Never document behavior that isn't implemented yet.** Write the code and tests first, then the docs. Writing docs first led to: StateBuilder destructuring that broke at runtime, a `dispatch:end` guarantee that wasn't enforced, and an error category that didn't exist.

### Subagent oversight
- **Review subagent output for: internal types leaked as exports, `any` in public APIs, missing `biome-ignore` comments.** Subagents don't know project conventions unless explicitly told.

### Internal exports
- **Only export what consumers need.** `HookRegistry`, `HOOK_EVENTS`, `NormalizedMigration` are internal. Check `index.ts` after subagents modify it.

### IDE autocomplete and variadic tuples
- **JetBrains IDEs (WebStorm/IntelliJ) can't infer generic parameters on arrow function class properties with variadic tuple rest params.** The fix: convert to regular methods (WebStorm uses a faster generic inference path for methods) and add a non-variadic overload for the common case (e.g. handler-only, no middleware). Use `this.method = this.method.bind(this)` in the constructor to preserve destructuring support.
- **Always add a simple overload above variadic ones.** IDEs try overloads in order — a trivial `(command, handler)` signature resolves instantly without variadic inference.

### Standard Schema type inference
- **Don't use `z.infer<T>` in public types or internal generics.** Inference flows through the structural `InferOut<T>` helper in `definition.ts`, which matches `T["~standard"]["types"]["output"]`. Using `z.infer` forces TypeScript through Zod's deep variance chain and breaks validator-agnostic support.
- **Don't constrain a library generic to `ZodType`.** Use `StandardSchemaV1` (from `./standard.js`) if you need any constraint; prefer `unknown` at config slot positions (see `WorkflowConfigInput`). Constraining to `ZodType` drags Zod's variance chain into every consumer file.
- **Never call `.safeParse()` or `.parse()` in router/context/definition code.** Use `validateSchema(schema, value)` from `./standard.js` — returns `{ ok: true, value } | { ok: false, issues }` via the `["~standard"].validate()` protocol.
- **Async validators are rejected at the boundary.** `validateSchema` throws if `.validate()` returns a Promise. Zod and ArkType are sync by default; Valibot users must not use `*Async` schemas.
- **Server fields are declared, not branded.** Use `state({ schema, server: ["key1", "key2"] })` for states with server-only fields. The server key list is type-checked against `keyof InferOutput<schema>`. Runtime stripping is a key-delete loop (no schema introspection). See `docs/guide/server-fields.md`.
