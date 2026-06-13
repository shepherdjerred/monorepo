# OCI Helm-chart typing + weekly helm-types refresh PR

## Status

Complete (pending PR review/merge)

## Context

Resolves the deferred item from PR #1141 (`packages/docs/todos/oci-helm-chart-types.md`): three Helm charts served from **OCI registries** are still untyped — `kueue`, `dagger-helm`, `agent-stack-k8s` (buildkite). Their ArgoCD `valuesObject` is a raw object, so typos/wrong paths fail at deploy time (the exact class of bug #1141 caught for HTTP-repo charts: pyroscope's `alloy-stack` no-op, kyverno's `policyReportsCleanup`).

Two parts:

- **A — type the OCI charts** (the deferred item).
- **B — keep all generated types fresh**: a weekly Temporal workflow that regenerates types and opens a PR when they drift, following the existing **scout data-dragon** pattern (deterministic regen → `gh pr create` via GitHub App token). Today `generate-helm-types` only runs at setup/manually, so committed types silently lag chart bumps.

**Base branch:** off `feature/helm-types-hygiene` (PR #1141, not yet merged — it has the generator + typed-params this builds on). Rebase onto main once #1141 lands. New worktree `.claude/worktrees/oci-helm-types` off that branch.

## De-risking findings (validated read-only against the live registries)

- **All three pull anonymously** (`helm show chart/values oci://…` succeeded; local helm 4.2.1, Dagger image has 4.1.4 — both ≥3.8). Chart.yaml `name` = version-key for each (`kueue`, `dagger-helm`, `agent-stack-k8s`), so the untar dir is predictable. Bare-semver `--version` works → stripping `@sha256:…` is confirmed sufficient.
- **dagger + buildkite need `EXTENSIBLE_TYPE_PATTERNS`, not just annotation.** The homelab sets valid keys the charts only document **commented-out** in `values.yaml`, so the generator (infers from active defaults only) can't see them:
  - dagger `engine.{port, configJson, config}` — commented at chart `values.yaml` lines 10/21/69. `configJson` carries the load-bearing GC policy, so this is correct usage, NOT a bug.
  - buildkite `config.{queue, max-in-flight, empty-job-grace-period, default-checkout-params}` — active `config` defaults are only `prometheus-port`/`pod-pending-timeout`/etc.
    Mitigation: add `"dagger-helm": ["engine"]` and `"agent-stack-k8s": ["config"]` to `EXTENSIBLE_TYPE_PATTERNS` (`helm-types/src/config.ts`, keyed by the generator's chart name = versions-key) so those blocks become `{ [key: string]: unknown; …knownKeys }`. **Tradeoff (honest):** extensible blocks keep the inferred known keys but won't catch typos _within_ engine/config — so dagger/buildkite typing is partial (still catches top-level typos + typed known keys, like the pyroscope/kyverno wins). kueue gets full typing.
- **kueue types cleanly** — `controllerManager.manager.priorityClassName` and `managerConfig.controllerManagerConfigYaml` are active defaults; no extensible entry needed.
- **Lower-confidence, not yet validated (low risk):** (a) generated type names `KueueHelmValues`/`DaggerhelmHelmValues`/`Agentstackk8sHelmValues` — inferred from existing precedent (`mc-router`→`McrouterHelmValues`, `node-feature-discovery`→`NodefeaturediscoveryHelmValues`); confirm after first generate. (b) `EXTENSIBLE_TYPE_PATTERNS` and the #1141 well-known-fields code both live in `config.ts` but are separate functions — expect no interaction. (c) Part B worker image needs `helm` added — routine; data-dragon already proves the worker has network + the regen-and-PR pattern.

## Part A — Type the OCI charts

The fetcher (`packages/homelab/src/helm-types/src/chart-fetcher.ts`) already shells out to `helm` (`repo add`/`update`/`pull --untar`). OCI just needs `helm pull oci://…`. The OCI ref shape is already proven anonymously-pullable in CI by `argocd-helm-render.test.ts:199-202` (`oci://${repoURL.replace(/^https?:\/\//,"")}/${chart}`).

| Step                | File                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flag the type       | `helm-types/src/types.ts:3` + `cdk8s/scripts/parse-helm-charts.ts:6`             | add `oci?: boolean` to both `ChartInfo` shapes                                                                                                                                                                                                                                                                                                                                           |
| Discover OCI charts | `cdk8s/scripts/parse-helm-charts.ts`                                             | add `OCI_CHART_KEYS = new Set(["kueue","dagger-helm","agent-stack-k8s"])`; also scan `datasource=docker` lines whose version-key ∈ set; new regex `packageName=(\S+)`; for those set `repoUrl=registryUrl` (strip `https://`), `chartName=packageName`, strip `@sha256:…` from version, `oci=true`                                                                                       |
| OCI fetch           | `helm-types/src/chart-fetcher.ts:68` (`fetchHelmChart`)                          | branch on `chart.oci`: skip `repo add/update/remove`; run `helm pull oci://${repoUrl}/${chartName} --version <v> --destination <tmp> --untar`; **resolve the untar'd dir robustly** (read the single created subdir, don't assume `chartName` = dir name — kueue's `kueue/charts/kueue` untars to `kueue/`, dagger may be `dagger`≠`dagger-helm`) for `values.yaml`/`values.schema.json` |
| Extensible blocks   | `helm-types/src/config.ts` `EXTENSIBLE_TYPE_PATTERNS`                            | add `"dagger-helm": ["engine"]`, `"agent-stack-k8s": ["config"]` (keys are the generator's chart name = the versions-key) (see de-risking findings) — required for the apps to typecheck. Regenerate after                                                                                                                                                                               |
| Register            | `cdk8s/src/misc/typed-helm-parameters.ts`                                        | import + map `kueue: KueueHelmValues`, `"dagger-helm": DaggerhelmHelmValues`, `"agent-stack-k8s": Agentstackk8sHelmValues` (names = generator PascalCase of version key)                                                                                                                                                                                                                 |
| Annotate apps       | `argo-applications/{kueue,dagger,buildkite}.ts`                                  | extract inline `valuesObject` to a typed const `HelmValuesForChart<"…">`; remove the "Untyped:" breadcrumb comments; **fix any revealed mismatches** (anticipate latent bugs as in #1141)                                                                                                                                                                                                |
| Generated output    | `cdk8s/generated/helm/{kueue,dagger-helm,agent-stack-k8s}.types.ts` + `index.ts` | run `bun run generate-helm-types`; commit; verify deterministic (2 runs, 0 diff)                                                                                                                                                                                                                                                                                                         |
| Close the todo      | `packages/docs/todos/oci-helm-chart-types.md`                                    | delete (resolved)                                                                                                                                                                                                                                                                                                                                                                        |

**Caveats:** needs helm ≥3.8 (Dagger has alpine/helm 4.1.4; local devs modern). OCI pull is anonymous for all three (proven by the render test). Digest-suffixed versions (kueue, agent-stack-k8s) must strip `@sha256:…` before `--version`.

## Part B — Weekly helm-types refresh → PR (data-dragon pattern)

Mirror `packages/temporal/src/{workflows,activities}/data-dragon.ts` (deterministic regen + `gh pr create`, GitHub App token via `lib/github-app-token.ts` `createGitHubAppInstallationToken()`; `git push --force-with-lease` + `gh pr create --repo … --base main`).

| Step         | File                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity     | `packages/temporal/src/activities/helm-types-refresh.ts` (new) | clone/prepare repo (mirror data-dragon); `bun install` + build eslint-config & helm-types; run **only** `bun run generate-helm-types` in `packages/homelab/src/cdk8s` (NOT `scripts/setup.ts`/HA/Prisma codegen); `git add -- packages/homelab/src/cdk8s/generated/helm` (path-scoped); if diff → branch + commit + push + `gh pr create`; if clean → no-op. Heartbeat during the long pull. `GENERATED_PATHS = ["packages/homelab/src/cdk8s/generated/helm"]` |
| Workflow     | `packages/temporal/src/workflows/helm-types-refresh.ts` (new)  | thin `proxyActivities` wrapper, ~30 min timeout, retry maxAttempts 2                                                                                                                                                                                                                                                                                                                                                                                           |
| Export       | `packages/temporal/src/workflows/index.ts`                     | export `runHelmTypesRefresh`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Schedule     | `packages/temporal/src/schedules/register-schedules.ts`        | add `{ id: "helm-types-weekly-refresh", workflowType: "runHelmTypesRefresh", cronExpression: "0 6 * * 1", taskQueue: DEFAULT, overlap: SKIP, workflowExecutionTimeout: "30 minutes", memo: … }` (Mon 6am PT — after Renovate's Sun 3am window so it catches merged chart bumps)                                                                                                                                                                                |
| Worker image | `.dagger/src/image.ts` (temporal-worker build)                 | add the `helm` binary (the worker installs gh/kubectl/etc. but **not helm**; copy from `HELM_IMAGE` like `.dagger/src/typescript.ts:74-77`, or install). Without this the activity can't pull charts                                                                                                                                                                                                                                                           |

Reuses existing `GITHUB_APP_ID`/`GITHUB_APP_INSTALLATION_ID`/`GITHUB_APP_PRIVATE_KEY` env (already wired for data-dragon/pokeemerald). Deterministic — no Claude invocation.

**Note:** the job pulls _all_ ~24 charts (not just OCI) each run, so it keeps the whole `generated/helm/` tree fresh, not only the new OCI ones.

**Guardrail — only helm types are committed.** HA types and Prisma clients are instance-specific/private, **gitignored, and regenerated in Dagger CI — never committed** (`packages/home-assistant/AGENTS.md:32`). The refresh activity must therefore run _only_ `generate-helm-types` and stage _only_ `generated/helm/`; it must not invoke `scripts/setup.ts` or any HA/Prisma codegen, so it can never accidentally commit private generated output. `generated/helm/` is the sole committed generated artifact that benefits from this refresh.

## Sequencing

1. Part A first (self-contained: generator + cdk8s). Verify, commit.
2. Part B (temporal + worker image). Commit separately.
3. One PR, two commits. Part B depends on the worker-image helm addition deploying before the schedule can succeed — note in PR that the first scheduled run only works after the worker image ships.

## Verification

1. **Part A**: `cd packages/homelab/src/helm-types && bun test && bunx tsc --noEmit`; then `cd ../cdk8s && bun run generate-helm-types` twice → `git status` clean between runs; the 3 OCI type files exist and are non-trivial. `bun run typecheck` (validates the 3 annotated apps + revealed mismatches). `bun run build` + `bun test` (incl. `argocd-helm-render` if `CI=true`). `bunx eslint src`.
2. **Manual OCI fetch smoke** (local, has helm): confirm `helm pull oci://registry.k8s.io/kueue/charts/kueue --version <v> --untar` extracts a `values.yaml` — sanity for the fetcher branch before wiring.
3. **Part B**: `cd packages/temporal && bun run typecheck && bun test`; dry-run the activity locally against a throwaway branch if feasible (or rely on the deterministic data-dragon pattern it mirrors). Confirm the schedule registers via `register-schedules.ts` without opening a real PR in test.
4. Docs: mirror plan to `packages/docs/plans/2026-06-13_oci-helm-types-and-refresh.md`; session log. Delete the resolved todo.

## Post-merge

- First `helm-types-weekly-refresh` run requires the updated temporal-worker image (with helm) to be deployed. Watch the first Monday run; if it opens a noisy PR (large drift from long-stale types), that's expected once and reviewable.
- Confirm the 3 OCI apps still render via `argocd-helm-render` and that typing them surfaced/fixed any latent value bugs.

## Session Log — 2026-06-13

### Done

- **Part A — OCI typing** (commit `2b35974de`): `helm-types` fetches OCI charts via `helm pull oci://<repo>/<chart>` (no `repo add`), resolving the untar dir robustly. `parse-helm-charts` discovers the three OCI charts (`kueue`, `dagger-helm`, `agent-stack-k8s`) via an explicit allowlist, reading `registryUrl`+`packageName`, stripping `@sha256` digests, and handling version values that prettier wraps onto the next line. `EXTENSIBLE_TYPE_PATTERNS` marks `dagger-helm.engine` + `agent-stack-k8s.config` extensible. The three types are registered in `typed-helm-parameters.ts` and their argo-application `valuesObject`s are typed (kueue via a typed const; dagger/buildkite via `satisfies`, since the objects are large). Todo `oci-helm-chart-types.md` deleted.
- **Generator hardened (in Part A):** removed the destructive `rm -rf` before regeneration (a flaky fetch used to silently delete a committed type file — the promtail/kube-prometheus drift). Now writes in place, retries transient fetches 3×, prunes only charts removed from versions.ts, and throws if any chart can't be generated.
- **Part B — weekly refresh** (deterministic Temporal workflow, data-dragon pattern): new `activities/helm-types-refresh.ts` (clone → build eslint-config+helm-types → `generate-helm-types` → `git add -- generated/helm` → `openSeasonRefreshPr`), thin `workflows/helm-types-refresh.ts`, registered in `activities/index.ts` + `workflows/index.ts`, `helm-types-weekly-refresh` schedule (`0 6 * * 1` PT). `withHelm` added to the temporal-worker image (`.dagger/src/image.ts`), copied from `HELM_IMAGE`.
- **Generator prettier/robustness fix (follow-up commit):** the generator already used the repo's pinned prettier — the churn came from it failing before/at the prettier step. Scoped `helm repo update` to the temp repo and made the prettier step fail-fast; a full generate now produces a byte-clean tree. Removed the now-redundant prettier pass in the Part B activity.
- Verified: `helm-types` typecheck/build/test green; generator deterministic (2 runs, 0 diff); cdk8s typecheck/build/test/eslint green (the 3 annotations surfaced no breaking mismatches); temporal typecheck + tests green (workflow-bundle smoke test passes; schedule-timeout invariant updated for the new workflow); dagger hygiene clean.

### Remaining

- Open the PR (Part A pushed; Part B + docs to commit + push).
- **Post-merge:** the first `helm-types-weekly-refresh` run needs the updated temporal-worker image (with helm) deployed first. The first run may open a one-time larger PR if committed types are stale.

### Caveats

- **Prettier consistency (resolved):** earlier I thought the generator's prettier wrapped differently than the repo's, but they are the SAME prettier (3.8.3, same `.prettierrc` + astro plugin). The real bug: the generator (a) ran `helm repo update` with no args, which refreshes EVERY local helm repo — including the retired public bitnami repo that now 404s — aborting otherwise-fine fetches, and (b) silently "continued" when its prettier step errored, leaving raw (unwrapped) interface-generator output. Fixed both: `helm repo update <repoName>` (scope to the temp repo) and a fail-fast prettier step. A full generate now leaves the tree byte-clean (0 churn), so the weekly job only PRs on real type changes. The redundant `prettier --write` in the Part B activity was removed.
- dagger/buildkite typing is **partial**: `engine`/`config` are extensible (`[key: string]: unknown`), so typos _within_ those blocks aren't caught — but top-level keys and all other structure are. kueue is fully typed.
- The temporal-worker image grows by the helm binary (~50MB). Acceptable.
- Could not fully typecheck `.dagger/` locally (needs `dagger develop` for the SDK types); the change mirrors `withKubectl`/`withTalosctl` and the proven `typescript.ts` helm file-copy, and the dagger-hygiene check passes. CI validates the full dagger typecheck.
