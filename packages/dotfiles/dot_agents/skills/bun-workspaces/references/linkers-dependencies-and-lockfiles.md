# Bun linkers, dependencies, and lockfiles

Read this when selecting a linker/store, using catalogs, managing peer/optional dependencies, migrating lockfiles, or controlling lifecycle scripts.

## Isolated linker

The isolated layout prevents phantom dependencies and separates packages by peer set. New current workspaces default isolated through lockfile configuration, while existing projects preserve prior behavior.

## Global store

The global virtual store is experimental in 1.3.14, off by default, and isolated-only. It is separate from the ordinary global cache. Repository-specific shared-store warnings remain authoritative until revalidated.

## Catalogs

Use `workspaces.catalog` for the default and `workspaces.catalogs` for named groups. Catalog dependencies participate in the lockfile and are rewritten during publishing.

## Dependency classes

Regular, dev, peer, and optional dependencies have distinct consumer/install semantics. Bun installs peers and optionals by default. Use `bun add --peer` and `--optional` from the target package.

## Lifecycle scripts

Trust is allow-listed. Root `trustedDependencies` replaces built-ins. `ignoreScripts` and CLI `--ignore-scripts` disable lifecycle execution. Inspect with `bun pm untrusted` before granting trust.

## Lockfile

The text `bun.lock` became default in Bun 1.2. `--lockfile-only` still updates lock/cache state. Preserve and verify binary-lock migration before deleting the source lockfile.

## Registries

Use scoped registry and token configuration through supported bunfig/npmrc/environment mechanisms. Never persist credentials into repository files or URLs.

## Primary documentation

- [Workspaces](https://bun.com/docs/pm/workspaces.md)
- [Catalogs](https://bun.com/docs/pm/catalogs.md)
- [Isolated installs](https://bun.com/docs/pm/isolated-installs.md)
- [Filters](https://bun.com/docs/pm/filter.md)
- [Lockfile](https://bun.com/docs/pm/lockfile.md)
- [Lifecycle scripts](https://bun.com/docs/pm/lifecycle.md)
- [Global cache](https://bun.com/docs/pm/global-cache.md)
- [Global store](https://bun.com/docs/pm/global-store.md)
- [Overrides](https://bun.com/docs/pm/overrides.md)
- [Scopes and registries](https://bun.com/docs/pm/scopes-registries.md)
- [.npmrc](https://bun.com/docs/pm/npmrc.md)
- [bunfig](https://bun.com/docs/runtime/bunfig.md)
- [Install](https://bun.com/docs/pm/cli/install.md)
- [Add](https://bun.com/docs/pm/cli/add.md)
- [Remove](https://bun.com/docs/pm/cli/remove.md)
- [Update](https://bun.com/docs/pm/cli/update.md)
- [Outdated](https://bun.com/docs/pm/cli/outdated.md)
- [Link](https://bun.com/docs/pm/cli/link.md)
- [Package manager utilities](https://bun.com/docs/pm/cli/pm.md)
- [Patch](https://bun.com/docs/pm/cli/patch.md)
