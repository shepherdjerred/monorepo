---
id: oci-helm-chart-types
status: deferred
origin: packages/docs/plans/2026-06-12_helm-types-and-resources-hygiene.md
source_marker: false
---

# Generate typed Helm values for OCI-registry charts

## Problem

`HelmValuesForChart<...>` typing covers charts served from classic Helm HTTP
repos. Three charts are served from **OCI registries** and remain untyped — their
`valuesObject` in the ArgoCD Application is a raw object, so typos and wrong value
paths only fail at deploy time (exactly the class of bug that the 2026-06-12
hygiene PR fixed for HTTP-repo charts, including a real `pyroscope` `alloy-stack`
no-op and a stale `kyverno` `policyReportsCleanup` key).

Untyped OCI charts:

| Chart                       | Registry                       | versions.ts key   |
| --------------------------- | ------------------------------ | ----------------- |
| kueue                       | `registry.k8s.io/kueue/charts` | `kueue`           |
| dagger-helm                 | `registry.dagger.io`           | `dagger-helm`     |
| agent-stack-k8s (buildkite) | `ghcr.io/buildkite/helm`       | `agent-stack-k8s` |

## Why it's deferred (not cheap)

The generator's `scripts/parse-helm-charts.ts` selects charts by the
`renovate: datasource=helm` annotation and fetches them over the Helm HTTP repo
protocol. OCI charts are annotated `datasource=docker` (renovate models OCI as
docker) — the **same** datasource used by plain container images like
`library/python`. So two pieces of work are required:

1. A way to distinguish an _OCI Helm chart_ from an _OCI container image_ — both
   are `datasource=docker`. Options: an explicit marker (e.g. a
   `# helm-types: oci` comment or a dedicated annotation field), or an allowlist
   of OCI-chart version keys.
2. OCI fetch support in the type generator: `helm pull oci://<registryUrl>/<packageName> --version <v>`
   then extract `values.yaml` / `values.schema.json`, mirroring the existing
   HTTP path in `src/helm-types/src/cli.ts`. Mind the `packageName` path
   component (e.g. kueue's is `kueue/charts/kueue`).

## Acceptance

- The three charts above generate `generated/helm/<name>.types.ts`, are registered
  in `src/misc/typed-helm-parameters.ts`, and their ArgoCD Application value
  objects are annotated `HelmValuesForChart<"...">` with any revealed mismatches
  fixed.
- Regeneration stays deterministic (two consecutive `bun run generate-helm-types`
  runs produce zero git diff).
