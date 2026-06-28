# Helm-values typing + container-resources hygiene (follow-up PR)

## Status

Complete — shipped in PR #1135.

## Context

The 2026-06-12 right-sizing audit (PR #1135) exposed three systemic issues this PR fixes properly:

1. **Untyped helm values**: kueue, alloy, pyroscope, dagger, buildkite (and tempo, which HAS generated types but doesn't use them) pass raw objects as `valuesObject` — typos and wrong value paths only fail at deploy time.
2. **Generated types too narrow**: with no `values.schema.json`, types are inferred from chart defaults — e.g. 1Password connect's `resources.requests` type only allows `cpu?: number`, making it impossible to set a memory request without a (banned) type assertion.
3. **Container-resources footgun pair**: bare `addContainer` silently inherits cdk8s-plus's 1 CPU/512Mi default (the 5 collectors + eufy init bug), while `withCommonProps` silently injects `resources: {}` → BestEffort (the birmel/scout bug). Nothing forces a visible decision.

New worktree/branch off main **after PR #1135 merges** (it touches the same argo-application files; branching before would conflict).

## Thread 1 — Type the untyped charts

Pipeline: `src/cdk8s/scripts/generate-helm-types.ts` reads chart entries from `src/versions.ts` renovate annotations via `scripts/parse-helm-charts.ts`, emits `generated/helm/<chart>.types.ts`, registered in `src/misc/typed-helm-parameters.ts` (`HelmChartValuesMap`), consumed as `HelmValuesForChart<"name">`.

| Chart                                                               | Gap                                                                                                                               | Fix                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tempo                                                               | types generated + registered(?) but `tempo.ts` uses a raw object                                                                  | annotate `tempoValues: HelmValuesForChart<"tempo">`, fix any revealed mismatches                                                                                                                    |
| kyverno                                                             | types generated; check registration + usage in `kyverno.ts`                                                                       | register/annotate as needed                                                                                                                                                                         |
| alloy, pyroscope, kueue                                             | versions.ts annotations exist but no generated types — find why `parse-helm-charts.ts` skips them (filter list? registry scheme?) | make generation pick them up; register; annotate values objects in `alloy.ts`, `pyroscope.ts`, `kueue.ts`                                                                                           |
| dagger (`registry.dagger.io`), buildkite (`ghcr.io/buildkite/helm`) | OCI registries                                                                                                                    | if the fetcher can gain OCI support cheaply (`helm pull oci://…` or direct OCI pull), do it; otherwise leave untyped, document in code comment + file `packages/docs/todos/oci-helm-chart-types.md` |

## Thread 2 — Permissive types for well-known k8s fields

- In `src/helm-types/src/type-converter.ts` (~line 493, where `isK8sResourceSpec(propertyName)` triggers `augmentK8sResourceSpec()` in `type-converter-helpers.ts`): instead of mirroring defaults, emit a standard permissive shape for `resources`:
  `requests?: Record<string, string | number>; limits?: Record<string, string | number>`
- Same treatment for `nodeSelector` (`Record<string, string>`), `tolerations` (`unknown[]`), `affinity` (`Record<string, unknown>`). Keep scope to these four; pattern lives next to `shouldAllowArbitraryProps()` in `src/helm-types/src/config.ts`.
- Add/extend unit tests in src/helm-types (existing test layout) for the new emission.
- **Regenerate all `generated/helm/*.types.ts`** and fix fallout:
  - `1password.ts`: add the api memory request that was blocked; cpu can become `"25m"` string.
  - Regeneration must be deterministic first — investigate the known drift where a regen run deletes `promtail.types.ts` (see `reference_setup_codegen_promtail_drift`); acceptance: two consecutive `bun run generate-helm-types` runs produce zero git diff.
- Optional hardening if determinism achieved: pre-commit/CI drift check (`generate-helm-types && git diff --exit-code generated/helm/`). Skip if flaky (generator fetches charts from the network — may belong CI-only or not at all; decide by how `argocd-helm-render.test.ts` handles network flakiness).

## Thread 3 — Make container resources an explicit decision

- **New ESLint rule** `require-container-resources` in `packages/eslint-config/src/rules/` (follow existing rule + RuleTester test layout, 42 precedents): error when the props object passed to `.addContainer(...)`/`.addInitContainer(...)` — directly or wrapped in `withCommonProps(...)`/`withCommonLinuxServerProps(...)` — has no `resources` key. A literal `resources: {}` is the visible BestEffort opt-in and passes. Enable it scoped to `packages/homelab` (cdk8s-plus is homelab-only) via the shared config's homelab surface, or as a rule the homelab `eslint.config.ts` turns on.
- **Remove the hidden `resources: {}`** from `commonProps` in `src/cdk8s/src/misc/common.ts` (and the inherited copy in `misc/linux-server.ts`).
- **Annotate the ~30 deliberately-BestEffort call sites** (ddns, freshrss, golink, gickup, syncthing, redlib, plex ×2, tautulli, prowlarr, recyclarr, s3-static-site, + whatever the rule flags) with explicit `resources: {}` and a one-line "deliberately BestEffort" comment. Synthesized YAML must be byte-identical for these (verify via dist diff).
- **Synth-level backstop test** `src/cdk8s/src/container-resources.test.ts` (pattern: `setupCharts(app)` → `app.synthYaml()` → `parseAllDocuments`, as in `helm-compatibility.test.ts`): every container AND initContainer in synthesized output has cpu+memory requests, OR its workload name is in an allowlist at `src/cdk8s/src/misc/container-resource-allowlist.ts` (one-line rationale per entry). This catches raw-ApiObject manifests the ESLint rule can't see.

## Order of work

1. Thread 3 (self-contained, no network): rule + tests in eslint-config → rebuild eslint-config → commonProps change + call-site annotations + synth test in homelab.
2. Thread 2 generator fix + determinism, regenerate, fix fallout (1password).
3. Thread 1 registrations/annotations (depends on regenerated output for alloy/pyroscope/kueue).
4. Single PR; commits per thread.

## Verification

1. eslint-config: `bun test` (RuleTester suites) + build.
2. homelab: `bunx eslint .` — zero errors after annotations; intentionally delete a `resources` key locally to confirm the rule fires, then restore.
3. `cd src/cdk8s && bun run build` — diff `dist/` against pre-change synth: only expected deltas (none for BestEffort annotations; 1password memory request added).
4. `bun run generate-helm-types` twice → `git status` clean between runs; `bun run typecheck` + `bun test` green (new container-resources.test.ts and helm-types tests included).
5. Root `bun run typecheck` + homelab pre-commit suite via the commit itself.
6. Docs: mirror plan to `packages/docs/plans/2026-06-12_helm-types-and-resources-hygiene.md`; session log; todo doc only if OCI typing is deferred.

## Session Log — 2026-06-12

### Done

- **Thread 3** — ESLint rule `custom-rules/require-container-resources` (`packages/eslint-config/src/rules/require-container-resources.ts` + test, 15 cases), enabled in `packages/homelab/src/cdk8s/eslint.config.ts`. Removed the hidden `resources: {}` from `commonProps` (`src/cdk8s/src/misc/common.ts`). Annotated 19 deliberately-BestEffort call sites across 16 files with explicit `resources: {}` + rationale. Added synth backstop `src/cdk8s/src/container-resources.test.ts` + allowlist `src/cdk8s/src/misc/container-resource-allowlist.ts` (21 entries, bidirectionally enforced).
- **Thread 2** — Generator now emits canonical permissive types for well-known k8s fields (`resources`, `nodeSelector`, `tolerations`, `affinity`) instead of defaults-derived narrow ones; `getWellKnownK8sFieldType` in `src/helm-types/src/config.ts`, wired into `type-converter.ts`. Removed the now-dead `augmentK8sResourceSpec`/`isK8sResourceSpec`. Added converter unit tests + updated the integration/snapshot tests that asserted the old narrow output. Regenerated all 24 `generated/helm/*.types.ts`; **verified deterministic** (two consecutive runs, zero diff). Fixed the 1Password api memory request that the old narrow type blocked.
- **Thread 1** — Registered + annotated `alloy`, `pyroscope`, `tempo`, `kyverno`, `mariadb` (typed `HelmValuesForChart<...>`). Two real latent bugs surfaced by the annotations:
  - **pyroscope**: `"alloy-stack": { enabled: false }` was a silent no-op (the chart's key is `alloy`), so the bundled `pyroscope-alloy-0` StatefulSet ran despite the dedicated eBPF DaemonSet. Fixed to `alloy: { enabled: false }`.
  - **kyverno**: `policyReportsCleanup` is not a chart key (no-op); the sibling `webhooksCleanup` bitnami/kubectl override is obsolete at chart 3.8.0 (default is now `kyverno/readiness-checker`). Removed the whole stale block.
- Verified: typecheck/build/test/eslint green in eslint-config, helm-types, and cdk8s; synth confirms pyroscope `alloy.enabled=false`, kyverno block gone, 1password api `memory: 64Mi`.

### Remaining

- **OCI-registry charts** (kueue, dagger, buildkite) stay untyped — they use `datasource=docker`, indistinguishable from plain images, and need `helm pull oci://` support. Deferred to `packages/docs/todos/oci-helm-chart-types.md`; breadcrumb comments added at each `valuesObject`.
- Post-merge: ArgoCD sync will remove `pyroscope-alloy-0` (intended) and reconcile the kyverno cleanup-hook images. Confirm pyroscope still profiles via the dedicated alloy DaemonSet.

### Caveats

- The generator's own internal `tsc` self-check prints a `TS5112` warning (tsconfig present + files-on-commandline). Pre-existing, not introduced here; the real cdk8s typecheck passes. Worth fixing separately (add `--ignoreConfig` or point at a tsconfig).
- Regenerating brought several other `generated/helm/*.types.ts` current (they were mildly stale); diff is dominated by the well-known-field change plus that drift. Compile-time only — no synth impact.
