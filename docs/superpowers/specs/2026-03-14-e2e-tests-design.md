# E2E Tests Against Published npm Package

## Problem

The existing tests and examples use `workspace:*` to link to the local source. Nothing verifies that the published `@rytejs/core` npm package actually works for real consumers.

## Solution

A standalone test project in `examples/e2e` that installs `@rytejs/core` from npm at the exact version matching `packages/core/package.json` and runs assertions against it.

## Structure

```
examples/e2e/
  package.json      — excluded from pnpm workspace, uses exact npm version
  tsconfig.json
  e2e.test.ts       — vitest test file with real workflow assertions
```

### Workspace exclusion

`pnpm-workspace.yaml` is updated to exclude `examples/e2e`:

```yaml
packages:
  - "packages/*"
  - "docs"
  - "examples/*"
  - "!examples/e2e"
```

This ensures the main workspace does not link the local source — `examples/e2e` always installs from the npm registry.

### package.json

```json
{
  "name": "@rytejs/example-e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@rytejs/core": "0.2.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

The version (`0.2.0`) is updated by the CI workflow to match `packages/core/package.json` before install.

## Test coverage

The test file is a living example showcasing real usage with assertions:

1. **Define a workflow** with states, commands, events, and errors (Zod schemas)
2. **Fluent router setup** using chained `.state()` and `.on()` calls
3. **Dispatch and assert state transitions** — verify `result.ok`, new state, new data
4. **Event emission** — verify events are accumulated per dispatch
5. **Domain errors** — verify `ctx.error()` returns typed error with rollback
6. **Composable routers** — verify `.use(childRouter)` merges handlers correctly

## CI workflow

New `.github/workflows/e2e.yml`:

1. Triggered on push to master
2. Reads the version from `packages/core/package.json`
3. Updates `examples/e2e/package.json` to use that exact version
4. Runs `npm install` in `examples/e2e` (not pnpm — standalone project)
5. Runs `npx vitest run`
6. Runs on Node.js 22 only (not a matrix — the unit tests already cover 18/20/22)

## What this catches

- Package not published (install fails)
- Published version doesn't match repo version (install fails)
- Missing exports or broken entry points (import fails)
- Type definition issues (typecheck fails)
- Runtime bugs in the published build (assertions fail)
