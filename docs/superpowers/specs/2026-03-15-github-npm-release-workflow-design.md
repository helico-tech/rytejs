# GitHub NPM Release Workflow Design

## Overview

Automate NPM publishing of `@rytejs/core` and `@rytejs/testing` via a GitHub Actions workflow triggered by git tag pushes. The workflow builds, tests, publishes to npm, and creates a GitHub Release with auto-generated notes.

## Decisions

- **Versioning:** Locked — both packages always share the same version number
- **Trigger:** Git tag push matching `v*`
- **Changelog:** None in-repo — GitHub auto-generated release notes only
- **Auth:** Long-lived `NPM_TOKEN` stored as a GitHub repo secret
- **GitHub Release:** Auto-created with generated notes from commits/PRs since last tag

## Workflow: `.github/workflows/release.yml`

**Trigger:** `push.tags: ["v*"]`

**Permissions:** `contents: write` (for creating GitHub Releases)

**Steps:**

1. Checkout code
2. Setup pnpm via `pnpm/action-setup@v4` (reads version from `packageManager` field automatically, consistent with CI)
3. Setup Node.js 22 with npm registry URL (`https://registry.npmjs.org`)
4. `pnpm install --frozen-lockfile`
5. Validate tag matches package version — extract version from tag, compare to `packages/core/package.json`. Fail if mismatched.
6. `pnpm turbo run build typecheck test` — fail fast, don't publish broken code
7. `pnpm biome check .` — lint check, consistent with CI
8. `pnpm --filter @rytejs/core publish --access public --no-git-checks`
9. `pnpm --filter @rytejs/testing publish --access public --no-git-checks`
10. `gh release create $TAG --generate-notes` — create GitHub Release with auto-generated notes

**Environment variables:**

- `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` — scoped to publish steps only (steps 8-9)
- `GH_TOKEN: ${{ github.token }}` — for `gh release create` (automatic)

**Notes:**

- `@rytejs/testing` declares `@rytejs/core` as `workspace:^` peer dependency. pnpm resolves this to the correct semver range at publish time — no manual update needed.
- If `@rytejs/core` publishes but `@rytejs/testing` fails, re-running the workflow will fail on core (version already exists). Recovery: manually publish testing with `pnpm --filter @rytejs/testing publish --access public --no-git-checks`.

## Developer Release Process

1. Ensure `master` CI is green
2. `./scripts/bump-version.sh <version>` to sync all package versions
3. `git commit -am "chore: bump version to <version>"`
4. `git tag v<version>`
5. `git push && git push --tags`
6. Workflow runs automatically

## Setup Requirements

- Add `NPM_TOKEN` secret to GitHub repo: Settings > Secrets and variables > Actions
- The token needs publish permission for the `@rytejs` scope

## Files Changed

- **Add:** `.github/workflows/release.yml`
- **Rewrite:** `PUBLISHING.md` — current content is outdated (only covers manual single-package flow). Replace with the automated process documented above.

## What Stays the Same

- `scripts/bump-version.sh` — still used for version syncing
- `.github/workflows/ci.yml` — unchanged
- No new dependencies
