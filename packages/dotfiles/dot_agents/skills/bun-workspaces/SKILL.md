---
name: bun-workspaces
description: Current Bun workspace guidance for isolated and hoisted linkers, catalogs, filters, scripts, dependency classes, lockfiles, lifecycle trust, caches, publishing, TypeScript package exports, and containers. Use when configuring or reviewing a Bun monorepo.
---

# Bun Workspaces

Use one root workspace and lockfile, resolve internal packages through `workspace:*` links and package exports, and choose script scheduling from dependency order and task lifetime. Do not hide packaging errors with TypeScript source aliases.

## Current baseline

Verified against Bun 1.3.14 on 2026-08-03:

```bash
bun --version
```

New workspace projects with lockfile `configVersion = 1` default to the isolated linker. Existing and migrated projects preserve historical linker choices. Bun 1.3.14 adds an experimental isolated-linker global virtual store that is off by default.

Read [references/releases.md](references/releases.md) for the 49-page research ledger. Read [references/linkers-dependencies-and-lockfiles.md](references/linkers-dependencies-and-lockfiles.md) for linker, store, catalogs, dependency classes, lifecycle trust, and migration. Read [references/scripts-builds-and-publishing.md](references/scripts-builds-and-publishing.md) for filters, scheduling, package exports, TypeScript, CI, containers, audit, pack, and publish.

## Workspace declaration

The root owns the workspace patterns and shared lockfile:

```json
{
  "private": true,
  "workspaces": {
    "packages": ["packages/*"],
    "catalog": {
      "typescript": "^7.0.0"
    },
    "catalogs": {
      "testing": {
        "@types/bun": "latest"
      }
    }
  }
}
```

`catalog:` resolves the singular default catalog. A named catalog entry uses `catalog:name`. Do not put a named `default` group under `catalogs` and reference it as bare `catalog:`.

Internal package dependency:

```json
{
  "dependencies": {
    "@example/shared": "workspace:*"
  }
}
```

Bun rewrites workspace and catalog protocols appropriately during publication.

## Linker selection

| Project | Default/behavior |
| --- | --- |
| New workspace with current lockfile config | Isolated linker |
| New single-package project | Hoisted linker |
| Existing/pre-1.3.2 project | Preserves historical hoisted behavior unless changed |
| npm/yarn migration | Preserves hoisted model |
| pnpm migration | Uses isolated model |

Set the linker explicitly when deterministic strictness is required:

```toml
[install]
linker = "isolated"
```

Isolated installs prevent phantom dependencies and create peer-set-specific package identities. Test tools and bundlers against the real layout; do not depend on accidental hoisting.

## Cache versus global store

The global cache at `~/.bun/install/cache` stores fetched package content and metadata. The experimental global virtual store is different: it is isolated-linker-only, disabled by default, and symlinks projects through the cache's links area.

```toml
[install]
globalStore = true
```

Keep this setting machine-local unless the repository has revalidated parallel CI behavior. General upstream race-safety claims do not supersede the repository's known shared-store CI constraint.

## Dependencies

Bun installs peer and optional dependencies by default. `peerDependenciesMeta.optional` means a peer may be absent; it does not force installation.

```bash
bun add --cwd packages/shared lodash
bun add --cwd packages/plugin --peer react
bun add --cwd packages/tool --optional native-addon
```

`bun add` does not have `--filter`; use `--cwd` or run from the package directory. Use omit flags only when the install contract intentionally excludes peer/optional packages.

## Lockfile and CI

`bun.lock` is the authoritative text lockfile. Use:

```bash
bun ci
```

`bun ci` is the concise frozen install. `bun install --lockfile-only` skips `node_modules` installation but writes the lockfile and can populate global cache metadata or Git/tarball dependencies.

Yarn v1 lockfile printing creates an interoperability artifact on every install; do not make it a generic default.

For `bun.lockb` migration, generate and inspect `bun.lock`, run a clean frozen install and focused verification, then remove the preserved binary source lockfile. Automatic migration occurs only when `bun.lock` is absent.

## Lifecycle trust

Dependency lifecycle scripts are allow-listed. `trustedDependencies` replaces Bun's built-in trusted list rather than extending it; an empty list trusts none. Non-registry sources require explicit trust.

`--ignore-scripts` disables project and trusted dependency lifecycle scripts. In bunfig, use `ignoreScripts`; there is no documented `lifecycle = ["postinstall"]` policy setting.

Review untrusted scripts before enabling them:

```bash
bun pm untrusted
bun pm trust <package>
```

## Script scheduling

Filtered finite scripts honor workspace dependency order; independent packages can overlap. Use dependency-aware default execution for builds:

```bash
bun run --filter '*' build
```

Long-running dev servers block dependents under dependency ordering. Run intended independent servers explicitly in parallel:

```bash
bun run --parallel --workspaces --if-present dev
```

Focused execution remains the default during development. Do not apply blanket parallelism to builds whose order matters.

## Updates and overrides

`bun update` respects current semver ranges by default. For a reviewed workspace selection:

```bash
bun update --interactive --recursive
```

`--latest` can rewrite ranges across breaking versions and needs migration review.

Overrides/resolutions are top-level only and can affect direct or transitive dependencies. Document the reason and removal condition for every forced version.

## TypeScript and package exports

Resolve workspace packages through Bun's `node_modules` links and each package's `exports`. TypeScript warns against `paths` entries that point at monorepo package sources because they bypass real package `exports` and consumer resolution.

Use project references for compiler graph ordering. Put the `types` export condition before runtime conditions:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Export every documented subpath or import public types from the root. Choose Bun, Node, or browser build targets from supported consumers. TypeScript normally belongs in `devDependencies`, not peers, unless consumers use a compiler API in the public contract.

Do not add `skipLibCheck` to conceal workspace declaration errors.

## CI and containers

Use current `oven-sh/setup-bun@v2` and pin the project's Bun version instead of `latest`. In Docker, preserve workspace manifest paths; a wildcard copy into one directory flattens manifests and breaks the declared layout.

Prefer a pinned multi-stage image, install against the complete/preserved workspace tree, copy only runtime artifacts, and run as the image's non-root `bun` user.

## Pack, publish, and audit

Inspect package contents before publication:

```bash
bun pm pack
bun publish --dry-run --access public
bun audit
bun why <package>
```

Publishing is an external mutation requiring explicit package, registry, tag/access, artifact, and credentials. Bun strips/resolves workspace and catalog protocols. Publishing a supplied tarball does not run pack/publish lifecycle scripts. There is no implicit monorepo-wide publish command.

`bun audit` sends installed package/version data to npm and skips non-default registries. Account for that privacy and coverage boundary.

## Review checklist

- Verify Bun 1.3.14 and the lockfile config/linker history.
- Use isolated installs explicitly when strict dependency boundaries matter.
- Keep experimental global store machine-local until CI is revalidated.
- Use singular default catalog and named `catalogs` correctly.
- Add dependencies through package `--cwd`; do not invent add filters.
- Preserve peer/optional semantics and lifecycle trust policy.
- Use `bun ci` and inspect lockfile migration before deleting the old lock.
- Run finite builds dependency-aware and long-lived servers explicitly parallel.
- Resolve packages through workspace links/exports, not TypeScript source paths.
- Preserve workspace directories in Docker and use a non-root runtime stage.
- Dry-run and inspect package contents before authorized publication.
