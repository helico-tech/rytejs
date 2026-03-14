# Publishing @rytejs/core

Step-by-step instructions for publishing releases to npm.

## Prerequisites

- Node.js >= 18
- pnpm
- NPM account with `@rytejs` org access

## First-Time Setup

```bash
# Log in to npm
npm login

# Create the org (if it doesn't already exist)
npm org create rytejs
```

## Versioning

Use `npm version` from the package directory to bump the version. This updates `package.json`, creates a git commit, and tags it.

```bash
cd packages/core

# Patch release (0.1.0 → 0.1.1) -- bug fixes
npm version patch

# Minor release (0.1.0 → 0.2.0) -- new features, backwards-compatible
npm version minor

# Major release (0.1.0 → 1.0.0) -- breaking changes
npm version major
```

For a specific version:

```bash
npm version 1.0.0-beta.1
```

## Publishing a Release

1. **Bump the version:**

   ```bash
   cd packages/core
   npm version patch  # or minor/major
   ```

2. **Run full checks** to make sure everything passes:

   ```bash
   pnpm check
   ```

3. **Build** the package:

   ```bash
   pnpm --filter @rytejs/core build
   ```

4. **Publish** to npm:

   ```bash
   pnpm --filter @rytejs/core publish --access public
   ```

5. **Push the commit and tag:**

   ```bash
   git push --tags
   ```

## Docs Deployment

Documentation is built with VitePress and deployed to GitHub Pages.

- **Automated:** GitHub Actions deploys on push to `master`.
- **Manual:**

  ```bash
  cd docs
  npx vitepress build
  # Deploy the docs/.vitepress/dist directory to your hosting provider
  ```
