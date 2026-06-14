# Changelog

## [1.4.0](https://github.com/shepherdjerred/monorepo/compare/helm-types-v1.3.0...helm-types-v1.4.0) (2026-06-14)

Adds OCI-registry support to the chart fetcher and emits broader, more permissive generated types for well-known Kubernetes fields.

- `ChartInfo` gains an optional `oci?: boolean` flag; when true, `fetchHelmChart` pulls via `helm pull oci://<repoUrl>/<chartName>` instead of `helm repo add` + pull. The untarred chart directory is resolved by scanning for the extracted `Chart.yaml`, so charts whose untar directory name differs from `chartName` (e.g. `kueue/charts/kueue` extracting to `kueue/`) now work ([6875ca3](https://github.com/shepherdjerred/monorepo/commit/6875ca3534526d7bb418d1a8c13e21a337153f4a))
- Generated types for the well-known Kubernetes fields `resources`, `nodeSelector`, `tolerations`, and `affinity` now use canonical permissive shapes (e.g. `{ requests?: Record<string, string | number>; limits?: Record<string, string | number> }` for `resources`) instead of narrow shapes inferred from a chart's default subset. The narrow types previously blocked setting valid keys a chart didn't happen to default. A shape guard keeps RBAC-style `resources: ["secrets"]` arrays as arrays ([c3c268d](https://github.com/shepherdjerred/monorepo/commit/c3c268dbcca7622dd75ad544786d3011c90228bc))
- `EXTENSIBLE_TYPE_PATTERNS` gains entries for `dagger-helm.engine` and `agent-stack-k8s.config`, whose `values.yaml` documents valid keys only as commented-out examples that inference-from-defaults can't see ([6875ca3](https://github.com/shepherdjerred/monorepo/commit/6875ca3534526d7bb418d1a8c13e21a337153f4a))
- HTTP-repo fetches now run `helm repo update <repoName>` against the just-added repo only, instead of refreshing every locally-configured helm repo, so a single unrelated stale repo (e.g. the retired public bitnami repo) no longer aborts an otherwise-fine fetch ([9409043](https://github.com/shepherdjerred/monorepo/commit/940904303284c662e3e8b9faa68c8cbe3bd80d13))
- `config.ts` no longer exports `K8S_RESOURCE_SPEC_PATTERN` or `isK8sResourceSpec`; the new entry point is `getWellKnownK8sFieldType(propertyName, value)`, which returns the canonical type string and description (or `undefined`) ([c3c268d](https://github.com/shepherdjerred/monorepo/commit/c3c268dbcca7622dd75ad544786d3011c90228bc))

## [1.3.0](https://github.com/shepherdjerred/monorepo/compare/helm-types-v1.2.1...helm-types-v1.3.0) (2026-05-27)

* Spawn errors from the chart fetcher now preserve the original error as `.cause`, so callers can inspect what `helm` or `git` actually failed with ([c285f88](https://github.com/shepherdjerred/monorepo/commit/c285f88a7387b679980e63dde07c8543a39cc217))
* Published `package.json` now has a cloneable `repository` URL (`git+https://github.com/shepherdjerred/monorepo.git` with `directory: packages/homelab/src/helm-types`), and corrected `bugs`/`homepage` links ([02a3c55](https://github.com/shepherdjerred/monorepo/commit/02a3c55932bc8a267cff74c44c76f75634dcfcf0))
* Bump runtime dep `zod` to `^4.4.3` ([d040b0b](https://github.com/shepherdjerred/monorepo/commit/d040b0b231ca7e047a29d306aa35c5e2a5744592))

## [1.2.1](https://github.com/shepherdjerred/monorepo/compare/helm-types-v1.2.0...helm-types-v1.2.1) (2026-04-22)


### Bug Fixes

* **root:** prettier format CHANGELOG, exclude CHANGELOGs from suppression check ([882eb12](https://github.com/shepherdjerred/monorepo/commit/882eb12e22cedeb00a205d887c69a4c0c92ba18d))

## [1.2.0](https://github.com/shepherdjerred/monorepo/compare/helm-types-v1.1.0...helm-types-v1.2.0) (2026-04-05)

### Features

- add ESLint config and remove eslint-disable suppressions ([3cb54ff](https://github.com/shepherdjerred/monorepo/commit/3cb54ffa1e1f8b5a54c6dd8251eed29542b087cb))

## [1.1.0](https://github.com/shepherdjerred/monorepo/compare/helm-types-v1.0.0...helm-types-v1.1.0) (2026-01-24)

### Features

- **helm-types:** add release-please for automated npm publishing ([6ff44a3](https://github.com/shepherdjerred/monorepo/commit/6ff44a30f964f6ac494b205ef1378b528e515bd3))
- **helm-types:** add release-please for automated npm publishing ([a2c3428](https://github.com/shepherdjerred/monorepo/commit/a2c3428e7c0cfb80652b405d2051a8874b3eda27))

### Bug Fixes

- **seaweedfs:** fix volume and s3 deployment issues on Talos ([#2525](https://github.com/shepherdjerred/monorepo/issues/2525)) ([378be62](https://github.com/shepherdjerred/monorepo/commit/378be620463e8b5ba63f5a9b9300c5469256acbc))
