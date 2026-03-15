# CLAUDE.md

## Project

@rytejs — type-safe workflow engine for TypeScript. Monorepo with `packages/core` and `packages/testing`.

## Commands

```bash
# Full check (typecheck + test + lint)
npx turbo run typecheck test && npx biome check .

# Per-package
cd packages/core && npx vitest run        # 149 tests
cd packages/testing && npx vitest run     # 29 tests
cd packages/core && npx tsc --noEmit      # typecheck
cd packages/core && npx tsup              # build dist (REQUIRED before testing package tests)

# Lint
npx biome check .                         # check
npx biome check --fix .                   # autofix
```

## Architecture

- **Command dispatch pattern**: `router.dispatch(workflow, { type, payload })` returns `DispatchResult` (never throws)
- **Koa-style middleware**: global → state-scoped → inline → handler (onion model)
- **Discriminated unions**: `DispatchResult` on `ok`, `PipelineError` on `category`, `Workflow` on `state`
- **Zod-driven types**: all type inference flows from Zod schemas — no manual type annotations
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
- **StateBuilder methods are arrow functions.** `({ on, use }) =>` destructuring works and is the documented style. NEVER convert them to regular methods.
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
- When documenting `PipelineError` categories, include ALL FOUR: `"validation"`, `"domain"`, `"router"`, `"unexpected"`
- `ValidationError.source` includes `"restore"` (from `definition.restore()`, not from `dispatch()`)

## Testing

- Vitest with `describe`, `test`, `expect`
- Test files in `__tests__/` directories, colocated with source
- Use `@rytejs/testing` utilities: `createTestWorkflow`, `expectOk`, `expectError`, `testPath`, `createTestDeps`
- Zod v4 is required (peer dependency)

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
