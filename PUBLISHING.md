# Publishing @ryte/core

Step-by-step instructions for publishing releases to npm.

## Prerequisites

- Node.js >= 18
- pnpm
- NPM account with `@ryte` org access

## First-Time Setup

```bash
# Log in to npm
npm login

# Create the org (if it doesn't already exist)
npm org create ryte
```

## Publishing a Release

1. **Update the version** in `packages/core/package.json`.

2. **Run full checks** to make sure everything passes:

   ```bash
   pnpm check
   ```

3. **Build** the package:

   ```bash
   pnpm --filter @ryte/core build
   ```

4. **Publish** to npm:

   ```bash
   pnpm --filter @ryte/core publish --access public
   ```

5. **Tag the release** and push:

   ```bash
   git tag v<version>
   git push --tags
   ```

## Docs Deployment

Documentation is built with VitePress and deployed to GitHub Pages.

- **Automated:** GitHub Actions deploys on push to `main` (if configured).
- **Manual:**

  ```bash
  cd docs
  npx vitepress build
  # Deploy the docs/.vitepress/dist directory to your hosting provider
  ```
