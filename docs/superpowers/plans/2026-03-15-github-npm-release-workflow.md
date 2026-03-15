# GitHub NPM Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate NPM publishing of `@rytejs/core` and `@rytejs/testing` via a GitHub Actions workflow triggered by git tag pushes.

**Architecture:** Single GitHub Actions workflow triggered by `v*` tag push. Validates tag matches package version, runs full CI checks, publishes both packages to npm, and creates a GitHub Release with auto-generated notes.

**Tech Stack:** GitHub Actions, pnpm, turbo, gh CLI

**Spec:** `docs/superpowers/specs/2026-03-15-github-npm-release-workflow-design.md`

---

## Chunk 1: Release Workflow and Documentation

### Task 1: Create the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow file**

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
          registry-url: "https://registry.npmjs.org"

      - run: pnpm install --frozen-lockfile

      - name: Validate tag matches package version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION=$(node -p "require('./packages/core/package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "::error::Tag version ($TAG_VERSION) does not match package version ($PKG_VERSION)"
            exit 1
          fi

      - run: pnpm turbo run build typecheck test

      - run: pnpm biome check .

      - name: Publish @rytejs/core
        run: pnpm --filter @rytejs/core publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish @rytejs/testing
        run: pnpm --filter @rytejs/testing publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        run: gh release create ${{ github.ref_name }} --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add automated npm release workflow"
git push
```

### Task 2: Rewrite PUBLISHING.md

**Files:**
- Modify: `PUBLISHING.md`

- [ ] **Step 1: Replace PUBLISHING.md with updated content**

```markdown
# Publishing @rytejs packages

Releases are automated via GitHub Actions. When you push a version tag, the workflow builds, tests, publishes to npm, and creates a GitHub Release.

## Prerequisites

- NPM access token with publish permission for the `@rytejs` scope
- Token stored as `NPM_TOKEN` secret in GitHub repo settings (Settings > Secrets and variables > Actions)

## How to Release

1. Ensure `master` CI is green

2. Bump the version across all packages:

   ```bash
   ./scripts/bump-version.sh 0.5.0
   ```

3. Commit and tag:

   ```bash
   git commit -am "chore: bump version to 0.5.0"
   git tag v0.5.0
   ```

4. Push:

   ```bash
   git push && git push --tags
   ```

5. The release workflow runs automatically:
   - Validates the tag matches the package version
   - Runs `build`, `typecheck`, `test`, and `biome check`
   - Publishes `@rytejs/core` and `@rytejs/testing` to npm
   - Creates a GitHub Release with auto-generated notes

## Troubleshooting

### Partial publish failure

If `@rytejs/core` publishes but `@rytejs/testing` fails, re-running the workflow will fail on core (version already exists on npm). Manually publish testing:

```bash
pnpm --filter @rytejs/testing publish --access public --no-git-checks
```

### Tag-version mismatch

The workflow validates that the git tag matches the version in `packages/core/package.json`. If they don't match, the workflow fails before publishing. Fix the version, delete the tag, re-tag, and push.

## Docs Deployment

Documentation is built with VitePress and deployed to GitHub Pages automatically on push to `master`.
```

- [ ] **Step 2: Commit**

```bash
git add PUBLISHING.md
git commit -m "docs: rewrite PUBLISHING.md for automated releases"
```

- [ ] **Step 3: Push**

```bash
git push
```
