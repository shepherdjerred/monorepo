---
id: reference-completed-2026-05-13-cooklang-rich-preview-manifest-and-release
type: reference
status: complete
board: false
---

# Cooklang Rich Preview — Manifest Fix + Automated Versioned Releases

## Status Notes (Historical)

**Complete** — all plan-scoped work verified shipped to `main` during the 2026-06-06 docs groom; archived to `archive/completed/`. Original tracking status preserved below.

Partially Complete — implementation pushed on branch
`claude/fix-cooklang-manifest-nEUQg`; waiting for merge to `main` and the
first CI-driven publish on the plugin repo to validate the new flow
end-to-end.

## Context

The latest published v1.0.0 of the Obsidian plugin **Cooklang Rich Preview**
(external plugin repo commit `21bc2e2`,
Mar 4 2026) failed the directory's automated review with five manifest
checks. Investigation revealed the deeper problem: the release process is
fundamentally broken in a way that prevents shipping any fix.

**Why it's broken today:**

- `packages/cooklang-for-obsidian/manifest.json` pins `version: 1.0.0` and
  nothing in CI ever rewrites it (`.dagger/src/release.ts` only uses
  `--version` for commit messages + release tags, not manifest body).
- `cooklangPushHelper` uploads `main.js`, `manifest.json`, `styles.css` to
  the **plugin repo's main branch** via raw `gh api PUT` — no release, just
  files. Manifest still says 1.0.0 every time.
- `cooklangCreateReleaseHelper` creates a release on the **wrong repo**
  (`shepherdjerred/monorepo`) tagged `cooklang-rich-preview-v2.0.0-${BUILD_NUMBER}`.
  The Obsidian directory never sees it.
- The directory wants a release on the _plugin's own_ repo, tagged exactly
  matching `manifest.json#version`, plus a `versions.json` mapping each
  released version to its `minAppVersion`. We have none of that.
- The only release the directory ever saw (v1.0.0, Mar 4 2026) was created
  manually before CI was wired up. Every CI run since has been a no-op
  from the directory's perspective.
- Even the v1.0.0 manifest itself failed five checks: wrong `id`
  (`cooklang-for-obsidian`), `id` containing "obsidian", wrong `name`
  ("Cook Preview"), description without trailing punctuation, and
  `authorUrl` (`https://sjer.red`) returning HTTP 405 to `HEAD`. Source
  has since fixed four of those; only `authorUrl` remains (verified
  `HEAD https://sjer.red` → 405, `GET` → 200, Cloudflare/Astro default).

**Goal:** ship a corrected manifest _and_ establish a fully-automated
release flow that mirrors the existing `versionCommitBackHelper` pattern,
so every main-branch change to `packages/cooklang-for-obsidian/` produces a
real, directory-visible release on the plugin's repo.

## Approach

End-state release flow on main-branch merges that touch the package:

1. Build `main.js`, `manifest.json`, `styles.css` (unchanged from today).
2. Determine **next version**: read the latest tag on
   the configured plugin repo (semver tags only, e.g. `1.0.0`).
   If none, fall back to `manifest.json#version` in the built artifacts.
   Patch-bump the result (`1.0.0` → `1.0.1`). Major/minor stay manual via
   source edits.
3. Rewrite the built `manifest.json` to set `version` to the computed value.
4. On the plugin repo:
   - Update `manifest.json`, `main.js`, `styles.css` on `main`.
   - Read `versions.json`, append `{<newVersion>: <minAppVersion>}`,
     write back (commit alongside the artifact updates).
   - Create a GitHub release tagged exactly `<newVersion>` (no `v` prefix —
     Obsidian convention) with the three artifacts attached.
5. Open an auto-merge commit-back PR on `shepherdjerred/monorepo` that bumps
   `packages/cooklang-for-obsidian/manifest.json#version` to `<newVersion>`
   and appends the same entry to `packages/cooklang-for-obsidian/versions.json`.
   Mirrors `versionCommitBackHelper` (`.dagger/src/release.ts:636`),
   using branch `chore/cooklang-version-bump-pending`.

This keeps `manifest.json` in the monorepo eventually-consistent with what's
released and avoids two concurrent CI runs producing the same version
(each computes from the freshly-published tag).

## Files to modify

### New

- `packages/cooklang-for-obsidian/versions.json` — seed file:

  ```json
  { "1.0.0": "1.0.0" }
  ```

  Records the directory's existing v1.0.0 release so the first new flow
  run computes 1.0.0 → 1.0.1 correctly.

### Edits — package source

- `packages/cooklang-for-obsidian/manifest.json` (line 8):
  `"authorUrl": "https://sjer.red"` → `"https://github.com/shepherdjerred"`
  Verified `HEAD https://github.com/shepherdjerred` → 200. Other fields
  (`id`, `name`, description punctuation) already correct.

### Edits — release infrastructure

- `.dagger/src/release.ts`
  - **Delete** `cooklangCreateReleaseHelper` (lines 879–910): wrong repo,
    wrong tag scheme, no longer used.
  - **Replace** `cooklangPushHelper` with a unified
    `cooklangPublishHelper(artifacts, ghToken, dryrun)` that performs steps
    2–4 above. Pseudocode:

    ```sh
    clone https://github.com/shepherdjerred/monorepo/tree/main/packages/cooklang-for-obsidian into /repo
    latest=$(gh release list --repo shepherdjerred/monorepo \
              --json tagName -q '.[].tagName' | head -1)
    base=${latest:-$(jq -r .version /artifacts/manifest.json)}
    new=$(bump_patch "$base")
    jq --arg v "$new" '.version=$v' /artifacts/manifest.json > tmp && mv tmp /artifacts/manifest.json
    cp /artifacts/{main.js,manifest.json,styles.css} /repo/
    min=$(jq -r .minAppVersion /artifacts/manifest.json)
    jq --arg v "$new" --arg m "$min" '. + {($v): $m}' /repo/versions.json > tmp && mv tmp /repo/versions.json
    git -C /repo commit -am "release: v$new" && git push
    gh release create "$new" /repo/main.js /repo/manifest.json /repo/styles.css \
      --repo shepherdjerred/monorepo --title "v$new" --generate-notes
    echo "$new" > /version.out   # stdout for caller
    ```

    Emit the new version on stdout so the commit-back step can consume it.
    Use `GIT_ASKPASS` for auth (same pattern as `versionCommitBackHelper`),
    not tokens in URLs (per `CLAUDE.md` banned-patterns list).

  - **Add** `cooklangVersionCommitBackHelper(version, ghToken, dryrun)`:
    same shape as `versionCommitBackHelper` (`.dagger/src/release.ts:636`)
    but:
    - branch `chore/cooklang-version-bump-pending`
    - edits `packages/cooklang-for-obsidian/manifest.json` (jq version bump)
      and appends to `packages/cooklang-for-obsidian/versions.json`
    - commit title `chore(cooklang): bump to v<version>`

- `.dagger/src/index.ts`
  - **Delete** `cooklangPush`, `cooklangBuildAndPush`,
    `cooklangBuildAndRelease`, `cooklangCreateRelease` Dagger entrypoints
    (lines 1011–1050, 1121–1135).
  - **Add** `cooklangBuildAndPublish(pkgDir, ghToken, depNames, depDirs,
tsconfig, dryrun)`: builds, then calls `cooklangPublishHelper`,
    returning new version.
  - **Add** `cooklangVersionCommitBack(version, ghToken, dryrun)`:
    wraps the new commit-back helper.

- `scripts/ci/src/steps/cooklang.ts`
  - Replace the two-step group with:
    1. `:cook: Publish cooklang plugin` — `dagger call cooklang-build-and-publish ...` with metadata-set on stdout to capture the new version.
    2. `:cook: Commit version bump back` — depends on step 1; reads version
       via `buildkite-agent meta-data get`, calls
       `dagger call cooklang-version-commit-back --version=...`.
  - Drop the obsolete `--version "2.0.0-$BUILDKITE_BUILD_NUMBER"` flag.
  - Update the matching tests in
    `scripts/ci/src/__tests__/pipeline-builder.test.ts` (`cooklang-release`
    group key stays; step keys change).

## Edge cases & race conditions

- **Concurrent main builds**: each build reads the latest _published_ tag
  from the plugin repo before bumping, so a build that finishes second
  picks up the first's tag and produces version N+2. No collision.
- **Commit-back PR conflicts**: the same `--force-with-lease` + rebase
  pattern in `versionCommitBackHelper` handles two pending bumps queueing
  up. The auto-merge PR collapses them.
- **No-op builds**: the `cooklang-release` group already gates on
  `affected.cooklangChanged` in `scripts/ci/src/pipeline-builder.ts:290`,
  so unrelated commits don't cut releases.
- **Missing `versions.json` on plugin repo**: first run sees no file; the
  helper must initialise it as `{"1.0.0": "1.0.0", "<new>": "<min>"}`.
  Implemented by checking `[ -f /repo/versions.json ] || echo '{}' > /repo/versions.json`.
- **Tag normalisation**: Obsidian directory rejects `v`-prefixed tags for
  the version-match check. Use bare `1.0.1`, not `v1.0.1`.

## Verification

1. Local sanity — `cd packages/cooklang-for-obsidian && bun run typecheck
&& bun run build` succeeds; `main.js`, `manifest.json`, `styles.css`
   produced.
2. `bun run test` and `cd scripts/ci && bun run test` pass after pipeline
   test updates.
3. `scripts/check-dagger-hygiene.ts` passes — no banned patterns in the
   new Dagger code.
4. Dry-run end-to-end:
   `dagger call cooklang-build-and-publish --pkg-dir ./packages/cooklang-for-obsidian
--dep-names eslint-config --dep-dirs ./packages/eslint-config
--tsconfig ./tsconfig.base.json --gh-token env:GH_TOKEN --dryrun`
   should print the computed next version and the actions it would take,
   without touching either repo.
5. First real run after merge produces release `1.0.1` on
   the configured plugin repo with the corrected manifest and
   a `versions.json` containing `{"1.0.0":"1.0.0","1.0.1":"1.0.0"}`,
   plus an auto-merge PR on the monorepo bumping
   `packages/cooklang-for-obsidian/manifest.json` to 1.0.1.
6. Resubmit to the Obsidian directory; the `HEAD authorUrl` probe now
   returns 200 and all five manifest checks pass.

## Out of scope

- Renaming the package directory (`packages/cooklang-for-obsidian/` →
  `packages/cooklang-rich-preview/`). Internal-only name; the published
  manifest no longer references it. Defer to avoid churning
  `scripts/ci/src/change-detection.ts`, `.dagger/src/deps.ts`,
  `scripts/ci/src/steps/cooklang.ts`, etc.
- `package.json#version` in the monorepo — unused by Obsidian. Stays 1.0.0.

## Critical files (quick reference)

- `packages/cooklang-for-obsidian/manifest.json`
- `packages/cooklang-for-obsidian/versions.json` _(new)_
- `.dagger/src/release.ts` (cooklang helpers + commit-back pattern at line 636)
- `.dagger/src/index.ts` (lines 998–1050, 1121–1135)
- `scripts/ci/src/steps/cooklang.ts`
- `scripts/ci/src/__tests__/pipeline-builder.test.ts`
