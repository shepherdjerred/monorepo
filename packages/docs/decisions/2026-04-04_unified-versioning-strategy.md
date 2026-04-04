# Unified Versioning Strategy

**Date:** 2026-04-04
**Status:** Accepted

## Problem

Between February and April 2026, our CI versioning went through three eras:

| Era | Period            | Example Helm   | Example Docker  | Status                                |
| --- | ----------------- | -------------- | --------------- | ------------------------------------- |
| 1   | through ~Feb 15   | `1.0.0-3599`   | `1.0.0-2958`    | Correct                               |
| 2   | ~Feb 22 -- Mar 15 | `1.1.464`      | `1.1.152`       | Broken -- lost semver prerelease prefix |
| 3   | late Mar--present | `695`          | `695`           | Broken -- bare build number, no prefix  |

Era 2 broke when the `1.0.0-` prerelease prefix was replaced with a `1.x.` minor/patch scheme.
Era 3 broke further when the prefix was removed entirely.
Additionally, version commit-back stopped working, leaving `versions.ts` stale at Era 2 values.

Root causes included: monolithic release step coupling release-please with version extraction,
Buildkite `$` variable interpolation mangling shell scripts, and conflation of the helm-types npm
package version with the infrastructure version.

## Decision

Restore Era 1's scheme with a `2.0.0-` major bump to mark the CI overhaul. Use consistent semver
prerelease format (`MAJOR.MINOR.PATCH-BUILD`) across all non-npm artifacts. Introduce dev releases
for npm packages.

### Version Formats

| Artifact            | Format                      | Example              | Why                                                                           |
| ------------------- | --------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| Docker images       | `2.0.0-BUILD` + `:latest`  | `2.0.0-695`          | Valid semver; `@sha256:` digest provides immutability                          |
| Helm charts         | `2.0.0-BUILD`              | `2.0.0-695`          | ArgoCD `~2.0.0-0` tilde range auto-updates to latest prerelease              |
| NPM (prod)          | semver via release-please   | `0.1.0`              | Standard npm versioning; Renovate manages downstream consumers               |
| NPM (dev)           | `0.0.0-dev.BUILD`          | `0.0.0-dev.695`      | `dev` dist-tag; `npm install pkg` still gets stable, `pkg@dev` gets dev      |
| Clauderon (prod)    | semver via release-please   | `0.1.0`              | GitHub Release with proper semver tag                                        |
| Clauderon (dev)     | `0.0.0-dev.BUILD`          | `0.0.0-dev.695`      | GitHub pre-release; only built when clauderon code changes                   |
| Cooklang            | `2.0.0-BUILD`              | `2.0.0-695`          | Same as Helm/Docker for consistency                                          |
| versions.ts entries | `2.0.0-BUILD@sha256:...`   | `2.0.0-695@sha256:…` | Matches Docker tag format; only Docker images updated (Renovate handles npm) |
| Static sites        | none                        | N/A                  | Latest version always deployed; no versioning needed                         |
| Tofu infrastructure | none                        | N/A                  | Stateful infrastructure; no artifact versioning                              |

### Why `2.0.0-BUILD`

- **Semver prerelease**: `2.0.0-695` is valid semver. The build number is a numeric prerelease
  identifier that sorts correctly (`696 > 695`).
- **ArgoCD tilde matching**: `~2.0.0-0` means `>=2.0.0-0 <2.1.0`. Every `2.0.0-BUILD` falls in
  this range. ArgoCD automatically picks the highest matching version.
- **2.x major bump**: Marks the April 2026 CI infrastructure overhaul. Clearly distinguishes from
  Era 1 (`1.0.0-*`) and broken Eras 2--3.
- **Consistent across Docker + Helm**: Same format for both avoids the kind of divergence that
  caused Eras 2--3.

### Why `0.0.0-dev.BUILD` for NPM

- Sorts below ANY real release in semver (`0.0.0-dev.695 < 0.0.1 < 0.1.0`).
- Uses `dev` dist-tag so `npm install` defaults to stable, `npm install pkg@dev` gets latest dev.
- `--tolerate-republish` handles re-publish gracefully.
- Version is written to `package.json` inside the ephemeral Dagger container only -- never modifies
  the repo.

### Why Release-Please for NPM Only

Release-please manages semantic versioning for packages published to npm and consumed by external
users:

- `astro-opengraph-images`, `webring`, `@shepherdjerred/helm-types` (npm)
- `clauderon` (GitHub Releases, Rust binary)

Everything else (Docker images, Helm charts, cooklang, sites, infra) uses build numbers because they
are internal artifacts consumed by our own infrastructure, not external semver contracts.

## Scoping

Releases only run for affected packages. The pipeline generator detects which packages changed and
only generates publish steps for those. Touching `packages/helm-types/src/...` triggers a helm-types
dev publish. Touching `packages/birmel/src/...` builds birmel Docker images but does not publish
helm-types.

## Accelerated CI

PRs that only touch release-please files (`CHANGELOG.md`, `.release-please-manifest.json`,
`package.json` version bumps, `Cargo.toml`/`Cargo.lock`) or `versions.ts` skip quality gates.
The underlying code was already validated in the commit that triggered the release PR or version
bump.

## Migration

1. Single commit: update all CI version formats + ArgoCD `targetRevision`s
   (`~1.1.0-0` to `~2.0.0-0`).
2. Build publishes new `2.0.0-BUILD` charts; cdk8s synth produces updated ArgoCD manifests with
   `~2.0.0-0`.
3. ArgoCD syncs and picks up new versions.
4. After verification: clean up Era 2 + Era 3 artifacts (preserve versions currently in
   `versions.ts` for rollback safety).

## Caveats

- **Build numbers restart on CI migration**: If Buildkite is ever migrated or the pipeline
  recreated, build numbers restart. The `2.0.0-` prefix provides a stable base so `2.0.0-1` still
  sorts correctly within the `~2.0.0-0` range.
- **Clauderon dev releases are slow**: Rust cross-compilation for two architectures. Dev releases
  only run when clauderon code changes (`affected.clauderonChanged`), not on every commit.
- **Buildkite artifact transfer**: NPM publish steps previously used Buildkite artifacts to pass
  pre-built `dist/` between steps. This was unreliable (intermittent download failures). Now build +
  publish happen in a single Dagger call with Dagger's built-in caching.
- **`$$` escaping**: Buildkite interpolates `$VAR` in pipeline commands at upload time. Shell
  variables that need to survive to runtime must use `$$VAR`. Dagger step arguments that should be
  interpolated at upload time (like `$BUILDKITE_BUILD_NUMBER`) use single `$`.
