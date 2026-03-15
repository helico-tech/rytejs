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

The exact output file strategy and options need to be validated during implementation by running a prototype against the actual packages. The goal is to produce one Markdown page per package (`@rytejs/core` and `@rytejs/testing`).

```json
{
  "$schema": "https://typedoc-plugin-markdown.org/schema.json",
  "entryPointStrategy": "packages",
  "entryPoints": ["../packages/core", "../packages/testing"],
  "out": "./api",
  "plugin": ["typedoc-plugin-markdown"],
  "hidePageHeader": true,
  "hideBreadcrumbs": true,
  "treatWarningsAsErrors": true
}
```

**Note**: The `entryPointStrategy: "packages"` mode may produce a directory tree per package rather than a single flat file. During implementation, validate the actual output structure and adjust `outputFileStrategy` (e.g., `"modules"` or `"members"`) and any merging options as needed. The VitePress sidebar config (Section 4) must match the actual generated file paths.

**Note**: TypeDoc may read from `dist/index.d.ts` (via package `types` field) or from source. Verify that JSDoc comments survive the `tsup` build into `.d.ts` files. If they don't, configure TypeDoc to read from source entry points directly.

### 3. Build Integration

**Dependencies** added to `docs/package.json` (pin major versions):
- `typedoc` ^0.27
- `typedoc-plugin-markdown` ^4

**Scripts** in `docs/package.json`:
```json
"docs:api": "typedoc",
"build": "vitepress build",
"dev": "vitepress dev"
```

Note: `docs:api` is not inlined into `build` or `dev` — turbo handles the dependency ordering (see below). This avoids double-running the generation step.

**Turbo pipeline** in `turbo.json`:
```json
"docs#docs:api": {
  "dependsOn": ["^build"],
  "outputs": ["api/**"]
},
"docs#build": {
  "dependsOn": ["docs#docs:api"],
  "outputs": [".vitepress/dist/**"]
}
```

This ensures:
1. Packages are built first (TypeDoc needs resolved types)
2. API docs are generated before VitePress build
3. JSDoc validation (via `treatWarningsAsErrors`) runs in CI
4. Turbo caches the generated output

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

**Note**: The exact link paths depend on the actual TypeDoc output structure validated in Section 2. If TypeDoc produces directories instead of flat files, the links must be adjusted to match (e.g., `/api/core/index` instead of `/api/core`).

**`/api/` URL**: If TypeDoc generates an `index.md` at the root of `docs/api/`, it will serve as a landing page. If not, a small hand-written `docs/api/index.md` should redirect to `/api/core`. This file would be excluded from `.gitignore` if hand-maintained.

### 5. Cleanup

- Delete `docs/api/index.md` (replaced by generated output)
- Add `docs/api/` to `.gitignore` (generated files should not be committed; adjust pattern if a hand-maintained `index.md` redirect is needed)

## Risks

- **Cross-package resolution**: `@rytejs/testing` has a peer dependency on `@rytejs/core`. TypeDoc needs to resolve types across packages. Validate this works during implementation.
- **JSDoc survival in `.d.ts`**: If `tsup` strips JSDoc during compilation, TypeDoc must be configured to read source directly instead of declarations.
- **Output structure**: The exact file layout from `typedoc-plugin-markdown` with `entryPointStrategy: "packages"` must be validated empirically. The VitePress sidebar config depends on this.

## Files Changed

- `packages/core/src/*.ts` — JSDoc enrichment (no runtime changes)
- `packages/testing/src/*.ts` — JSDoc enrichment (no runtime changes)
- `docs/typedoc.json` — new TypeDoc configuration
- `docs/package.json` — new dependencies and scripts
- `docs/.vitepress/config.ts` — sidebar and nav updates
- `turbo.json` — new `docs#docs:api` and updated `docs#build` tasks
- `.gitignore` — add `docs/api/`
- `docs/api/index.md` — deleted

## What Does Not Change

- Guide pages (`docs/guide/`)
- Example pages (`docs/examples/`)
- Runtime code in either package
- Package exports or public API surface
