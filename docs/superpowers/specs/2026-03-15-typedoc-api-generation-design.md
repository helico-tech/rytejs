# TypeDoc API Documentation Generation

## Problem

API reference documentation (`docs/api/index.md`) is manually maintained and must be kept in sync with the actual TypeScript source code. This creates drift risk — when signatures, parameters, or types change, the docs can silently become stale.

## Solution

Replace the hand-written API reference with auto-generated documentation using TypeDoc + typedoc-plugin-markdown. Source code JSDoc comments become the single source of truth for all API documentation.

## Design

### 1. JSDoc Enrichment

Enrich all exported functions, classes, types, and interfaces in `packages/core/src/` and `packages/testing/src/` with:

- Descriptive summary comments
- `@param` tags with descriptions (ported from the current `docs/api/index.md` prose)
- `@returns` tags where meaningful

This improves IDE tooltips as a side benefit.

Example transformation:

```ts
// Before
/** Creates a workflow definition from a name and Zod schema configuration. */
export function defineWorkflow<const TConfig extends WorkflowConfig>(
  name: string,
  config: TConfig,
): WorkflowDefinition<TConfig>

// After
/**
 * Creates a workflow definition from a name and Zod schema configuration.
 *
 * @param name - Unique name for this workflow type
 * @param config - Object with `states`, `commands`, `events`, `errors` — each a record of Zod schemas
 * @returns A {@link WorkflowDefinition} with methods for creating instances and accessing schemas
 */
export function defineWorkflow<const TConfig extends WorkflowConfig>(
  name: string,
  config: TConfig,
): WorkflowDefinition<TConfig>
```

### 2. TypeDoc Configuration

**New file: `docs/typedoc.json`**

- `entryPointStrategy: "packages"` — points at `../packages/core` and `../packages/testing`
- `outputFileStrategy: "modules"` — produces one Markdown file per package (`core.md` and `testing.md`)
- `out: "./api"` — writes generated files into `docs/api/`
- `plugin: ["typedoc-plugin-markdown"]`
- `hidePageHeader: true`, `hideBreadcrumbs: true` — cleaner output for VitePress integration
- `treatWarningsAsErrors: true` — fails build on malformed or drifted JSDoc (e.g. `@param` referencing non-existent parameter)

### 3. Build Integration

**Dependencies** added to `docs/package.json`:
- `typedoc`
- `typedoc-plugin-markdown`

**Scripts** in `docs/package.json`:
```json
"docs:api": "typedoc",
"build": "pnpm docs:api && vitepress build",
"dev": "pnpm docs:api && vitepress dev"
```

**Turbo pipeline**: Add `docs:api` task that depends on package builds (TypeDoc needs resolved source). This ensures JSDoc validation runs in CI.

### 4. VitePress Configuration

**Sidebar** update in `docs/.vitepress/config.ts`:

```ts
"/api/": [
  {
    text: "API Reference",
    items: [
      { text: "@rytejs/core", link: "/api/core" },
      { text: "@rytejs/testing", link: "/api/testing" },
    ],
  },
],
```

**Nav** link updated to point to `/api/core` as the default API landing page.

### 5. Cleanup

- Delete `docs/api/index.md` (replaced by generated output)
- Add `docs/api/` to `.gitignore` (generated files should not be committed)

## Files Changed

- `packages/core/src/*.ts` — JSDoc enrichment (no runtime changes)
- `packages/testing/src/*.ts` — JSDoc enrichment (no runtime changes)
- `docs/typedoc.json` — new TypeDoc configuration
- `docs/package.json` — new dependencies and scripts
- `docs/.vitepress/config.ts` — sidebar and nav updates
- `turbo.json` — new `docs:api` task
- `.gitignore` — add `docs/api/`
- `docs/api/index.md` — deleted

## What Does Not Change

- Guide pages (`docs/guide/`)
- Example pages (`docs/examples/`)
- Runtime code in either package
- Package exports or public API surface
