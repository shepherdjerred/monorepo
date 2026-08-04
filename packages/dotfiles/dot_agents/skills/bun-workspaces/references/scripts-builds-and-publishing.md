# Bun workspace scripts, builds, and publishing

Read this when filtering scripts, building internal packages, configuring TypeScript, CI or Docker, auditing dependencies, packing, or publishing.

## Filters and task lifetime

Filters can select names and paths with negation. Finite tasks follow dependency order by default; long-lived tasks need deliberate parallel mode.

## TypeScript resolution

Package exports and workspace symlinks are the consumer oracle. Do not point TypeScript paths at package sources. Use project references for build ordering and typecheck each public package shape.

## Package output

Choose `--target node`, browser, or Bun from the consumer contract. Put `types` first in conditional exports and expose every public subpath.

## CI

Pin Bun and use setup-bun v2 plus `bun ci`. Avoid generated secondary lockfiles unless interoperability requires them.

## Docker

Preserve each workspace manifest's relative directory. Use a multi-stage build and non-root runtime. Pin the Bun image version/digest and copy only runtime artifacts.

## Audit and provenance

`bun why` explains dependency paths. `bun audit` reports npm advisory data, submits installed names/versions, and excludes non-default registries.

## Publication

`bun pm pack` and `bun publish --dry-run` expose the package contents. Publication rewrites workspace/catalog protocols. Review access/tag/registry and authorize the external mutation.

## Primary documentation

- [Publish](https://bun.com/docs/pm/cli/publish.md)
- [Audit](https://bun.com/docs/pm/cli/audit.md)
- [Info](https://bun.com/docs/pm/cli/info.md)
- [Why](https://bun.com/docs/pm/cli/why.md)
- [Workspace guide](https://bun.com/docs/guides/install/workspaces.md)
- [npm-to-Bun migration](https://bun.com/docs/guides/install/from-npm-install-to-bun-install.md)
- [Add peer](https://bun.com/docs/guides/install/add-peer.md)
- [Add optional](https://bun.com/docs/guides/install/add-optional.md)
- [Trusted dependencies](https://bun.com/docs/guides/install/trusted.md)
- [Install CI/CD](https://bun.com/docs/guides/install/cicd.md)
- [Runtime CI/CD](https://bun.com/docs/guides/runtime/cicd.md)
- [Yarn lockfile](https://bun.com/docs/guides/install/yarnlock.md)
- [Custom registry](https://bun.com/docs/guides/install/custom-registry.md)
- [Registry scope](https://bun.com/docs/guides/install/registry-scope.md)
- [Docker](https://bun.com/docs/guides/ecosystem/docker.md)
- [Module resolution](https://bun.com/docs/runtime/module-resolution.md)
- [Auto-install](https://bun.com/docs/runtime/auto-install.md)
- [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [TypeScript moduleResolution](https://www.typescriptlang.org/tsconfig/moduleResolution.html)
- [TypeScript skipLibCheck](https://www.typescriptlang.org/tsconfig/skipLibCheck.html)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Build cache optimization](https://docs.docker.com/build/cache/optimize/)
