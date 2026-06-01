# Reduce Buildkite Pod Disk Pressure via Dagger Git-URL Refactor

## Status

In Progress — PR1 underway.

**Phase 1.1 (gate test): ✅ PASSED 2026-05-31.** Confirmed `dagger call lint --pkg-dir https://github.com/shepherdjerred/monorepo.git#<ref>:packages/eslint-config --tsconfig …#<ref>:tsconfig.base.json` works against the in-cluster engine (v0.20.8) with both `#main` and `#<40-char SHA>` ref forms. Engine resolves git URLs server-side and presents them as `Address.directory`/`Address.file`. Cache hits work — re-running the same call drops total Dagger time from 10.9s to 4.4s. Multi-package (homelab + deps) also works. The fallback (`bunBaseContainer` refactor to accept `commit: string`) is **not** needed.

## Context

**The problem**: ~1,116 BK pods/hr churn on torvalds. Each does a `git clone --depth=100` of the monorepo into emptyDir, writing **1.3 GiB per pod** (584 MiB `.git` + 528 MiB working tree, 18,944 files). That checkout accounts for **~92% of the 1,580 GiB/hr** hitting `nvme1n1p4` (the Talos EPHEMERAL XFS partition). The drive saturates at 60% util, 115 ms write latency, controller temp peaks 92–96°C.

**What's NOT the problem**: Dagger. The engine on a separate cool ZFS drive (`nvme0`) is healthy — 98% op-level cache hit (Loki: 1,625 CACHED vs 35 EXEC markers/hr), 22–105 MiB/s writes, 3 cores peak, 6 GiB peak memory, 0 OOM, 0 panics. The Dagger engine PVC at 75% (767/1024 GiB) is a separate orange flag tracked as out-of-scope work.

**The fix**: Dagger CLI accepts `Directory` arguments as git URLs in the form `https://github.com/<owner>/<repo>.git#<sha>:<subpath>`. The engine fetches server-side, content-addressed by SHA, cached fetch-once-serve-many. Per-pod writes drop from ~1.3 GiB to ~10–30 MiB. **~50× write reduction** on the hot drive. This is the unlock for "Dagger does all the work" architecturally, and the unlock for scaling Buildkite concurrency.

**Why now**: The user wants to scale to 50 concurrent BK builds. At current per-pod write cost (1.3 GiB × ~85 MiB/s while active), 50 concurrent would require 4.25 GiB/s sustained writes — 8–10× the physical drive capacity. This refactor is a prerequisite, not a nice-to-have. It's also the queueing-correct answer: it reduces work per job rather than spreading the same work over more time.

The monorepo is **public**, so `dag.git()` works with no auth changes.

## Recommended approach

Two PRs:

**PR1 — git-URL flag refactor** (~60–75% write reduction alone, lowest risk per change)
**PR2 — migrate 18 plain quality steps + cleanup** (closes the remaining gap, removes `plainStep` entirely)

The two phases are independent — PR1 is fully shippable on its own. PR2 follows after PR1 metrics confirm the model works.

---

## PR1 — git-URL flag refactor

### 1.1 Verify the pattern first (pre-PR)

From shell with `_EXPERIMENTAL_DAGGER_RUNNER_HOST` set:

```
dagger call --pkg-dir https://github.com/shepherdjerred/monorepo.git#main:packages/eslint-config \
  lint --pkg eslint-config --tsconfig https://github.com/shepherdjerred/monorepo.git#main:tsconfig.base.json
```

Confirm exit 0 + engine logs a `dag.git()` fetch. If this fails, the rest is moot. Fall back is to refactor `bunBaseContainer` to take `commit: string` and call `dag.git()` inside — same outcome, more code.

### 1.2 Add git-URL helpers

**`scripts/ci/src/lib/buildkite.ts`** — add near top (alongside existing constants):

```ts
export const REPO_GIT_URL = "https://github.com/shepherdjerred/monorepo.git";
/** Git-URL ref interpolated by buildkite-agent pipeline upload (single $). */
export const REPO_GIT_REF = `${REPO_GIT_URL}#$BUILDKITE_COMMIT`;
export function gitDir(subdir: string): string {
  return `${REPO_GIT_REF}:${subdir}`;
}
export function gitFile(path: string): string {
  return `${REPO_GIT_REF}:${path}`;
}
```

Single-`$` escaping confirmed by existing `OTEL_RESOURCE_ATTRIBUTES` precedent at `lib/buildkite.ts:154`.

### 1.3 Skip checkout for dagger-call steps

**`scripts/ci/src/lib/k8s-plugin.ts`**:

- Lines 58–61: replace `cloneFlags`/`fetchFlags` block with `checkout: { skip: true }`
- Lines 81–87: delete the `buildkite-git-mirrors` volumeMount

The `CHECKED_OUT_CI_BASE_VERSION` read at lines 7–13 stays — it executes in the bootstrap pod which keeps its checkout (`.buildkite/pipeline.yml:5–28`). No change needed there.

### 1.4 Switch flag construction to git-URL refs

The pattern (per file): replace `./packages/${pkg}` → `gitDir(\`packages/${pkg}\`)`, replace `./tsconfig.base.json`→`gitFile("tsconfig.base.json")`, replace `--source .`→`--source ${REPO_GIT_REF}`. Files:

- `scripts/ci/src/steps/per-package.ts` — `daggerPkgFlags()` lines 24–32 + ~17 callsites for Bun/Go/LaTeX/Prisma flavors
- `scripts/ci/src/steps/cooklang.ts:22` — `COOKLANG_PKG_FLAGS`
- `scripts/ci/src/steps/helm.ts:33,47,62,63` — helm/synth flags
- `scripts/ci/src/steps/npm.ts:42` — publish-npm
- `scripts/ci/src/steps/images.ts:63,76,146,152,206,221` — build/push image flags
- `scripts/ci/src/steps/sites.ts:92,150` — deploy-site, mkdocs-build
- `scripts/ci/src/steps/release.ts:29`, `tofu.ts:29,64`, `version.ts:31`, `ci-image.ts:100` — `--source .` callsites
- `scripts/ci/src/steps/quality.ts:265` — `caddyfileValidateStep` (`--source .`)

### 1.5 PR1 verification

Land on a test branch with `[full-build]`. Confirm:

1. Rendered pipeline YAML contains `https://github.com/shepherdjerred/monorepo.git#<40-char SHA>:packages/<pkg>` in `command:` fields.
2. New per-package pods log no checkout activity (Loki `{namespace="buildkite"} |~ "checkout"` empty).
3. Dagger engine logs exactly one `dag.git()` fetch per unique SHA, served many times.
4. Typecheck + lint + test pass for `eslint-config`, `temporal`, `homelab` packages.
5. Disk metrics (24h window): `rate(node_disk_written_bytes_total{device="nvme1n1"}[5m])` drops from ~439 MiB/s baseline to under 200 MiB/s.

---

## PR2 — Plain step migration + cleanup

### 2.1 Create `.dagger/src/quality.ts`

One helper per check, sharing a `qualityBase(source: Directory): Container` factory. Pattern:

```ts
function qualityBase(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "git",
      "findutils",
      "grep",
    ])
    .withWorkdir("/repo")
    .withDirectory("/repo", source);
}

export function prettierHelper(source: Directory): Promise<string> {
  return qualityBase(source)
    .withExec(["bash", ".buildkite/scripts/prettier.sh"])
    .stdout();
}
// 17 more helpers, same shape
```

For scanners (Knip / Trivy / Semgrep / Gitleaks / Shellcheck / Semgrep), use upstream images instead of `setup-tools.sh`:

- `aquasec/trivy:${TRIVY_VERSION}`
- `returntocorp/semgrep:${SEMGREP_VERSION}`
- `zricethezav/gitleaks:${GITLEAKS_VERSION}`
- Shellcheck: `apt-get install shellcheck` in `qualityBase`

Version pins go to `.dagger/src/constants.ts` with Renovate `# renovate:` annotations.

For `mergeConflictStep` and `largeFileStep`: the `.conflictignore` and `.largeignore` files now live inside the Directory and are read in-container at execution time. Delete the `readIgnoreFile` machinery at `quality.ts:17–24`.

For `daggerHygieneStep`: greps `.dagger/src/`. Self-referential but harmless — the engine runs the grep on a Directory snapshot, not against its own live code. Migrate like the others.

### 2.2 Wire 14 `@func()` wrappers in `.dagger/src/index.ts`

Pattern:

```ts
@func() async prettier(source: Directory): Promise<string> { return prettierHelper(source); }
```

One wrapper per helper from 2.1.

### 2.3 Rewrite `scripts/ci/src/steps/quality.ts`

Two idioms:

**Idiom A — simple check** (14 of 18):

```ts
export function prettierStep(): BuildkiteStep {
  return daggerStep({
    label: ":art: Prettier",
    key: "prettier",
    daggerCmd: `dagger call prettier --source ${REPO_GIT_REF}`,
  });
}
```

**Idiom B — scan with annotation** (Knip, Trivy, Semgrep — 3 of 18):

```ts
function annotatedDaggerScan(fn: string, ctx: string): string {
  return [
    `set -o pipefail`,
    `dagger call ${fn} --source ${REPO_GIT_REF} 2>&1 | tee /tmp/${ctx}.txt`,
    `status=$$?`,
    `if [ $$status -ne 0 ] && [ -s /tmp/${ctx}.txt ]; then buildkite-agent annotate --style warning --context ${ctx} < /tmp/${ctx}.txt; fi`,
    `exit $$status`,
  ].join("; ");
}
```

`buildkite-agent` stays available in the BK pod (it's in `ci-base`). Annotation UX is identical to today.

`caddyfileValidateStep` (already `daggerStep`) just gets the `--source .` → `--source ${REPO_GIT_REF}` swap from PR1.

### 2.4 iOS native-deps step

`scripts/ci/src/steps/per-package.ts:244–256` runs `bash .buildkite/scripts/tasks-for-obsidian-ios-native-deps.sh`. Convert to a Dagger helper in the same shape as the quality fns. Fires only when `tasks-for-obsidian` is affected (rare) but completes the plainStep removal.

### 2.5 Cleanup

- Delete `plainStep` from `scripts/ci/src/lib/buildkite.ts` (lines 86–121). Update `scripts/ci/src/__tests__/` for any test referencing it.
- Delete `annotatedScanCmd` from `quality.ts:27–36` (replaced by `annotatedDaggerScan`).
- Delete `readIgnoreFile` from `quality.ts:17–24`.
- **`packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`**: delete `buildkite-git-mirrors` PVC (lines 67–74) and `default-checkout-params.gitMirrors` Helm value (lines 96–106).
- **`.buildkite/pipeline.yml`**: delete `volumeMounts: buildkite-git-mirrors` (lines 26–28).
- **`.buildkite/scripts/setup-tools.sh`**: remove `install_shellcheck`, `install_gitleaks`, `install_trivy`, `install_semgrep` (no longer called).

### 2.6 PR2 verification

Smoke PR touching one file in each category:

- TS package (`packages/eslint-config/src/index.ts`) → per-package group
- Markdown (`README.md`) → markdownlint
- Shell script → shellcheck
- Deliberately unused export → Knip should annotate
- `.conflictignore` → confirms in-container ignore-file read
- `packages/tasks-for-obsidian/ios/Podfile` → iOS native deps
- `packages/homelab/src/cdk8s/...` → cdk8s/helm path
- Go (`packages/terraform-provider-asuswrt/main.go`) → Go path
- LaTeX (`packages/resume/resume.tex`) → LaTeX path

Each step must (a) succeed, (b) skip checkout (verify `kubectl get pod -o yaml` shows no checkout init container and no `buildkite-git-mirrors` mount), (c) emit identical annotations/artifacts to baseline.

---

## Verification — end-to-end metrics

| Metric                     | Query                                                                                           | Baseline        | Target after PR1 | Target after PR2 |
| -------------------------- | ----------------------------------------------------------------------------------------------- | --------------- | ---------------- | ---------------- | ----- |
| `nvme1n1` write rate       | `sum(rate(node_disk_written_bytes_total{device="nvme1n1"}[5m]))`                                | ~439 MiB/s      | < 200 MiB/s      | **< 50 MiB/s**   |
| Per-pod p95 writes         | `quantile(0.95, sum by(pod)(rate(container_fs_writes_bytes_total{namespace="buildkite"}[5m])))` | ~1.3 GiB/pod    | < 400 MiB        | **< 30 MiB**     |
| NVMe1 controller temp peak | `max(node_hwmon_temp_celsius{chip="nvme_nvme1",sensor="temp3"})` 1h max                         | 92–96°C         | < 80°C           | **< 70°C**       |
| `nvme1` util %             | `rate(node_disk_io_time_seconds_total{device="nvme1n1"}[5m])`                                   | 60%             | < 30%            | **< 15%**        |
| `nvme1` p50 write latency  | `rate(node_disk_write_time_seconds_total[5m]) / rate(node_disk_writes_completed_total[5m])`     | 115 ms          | < 30 ms          | **< 10 ms**      |
| Dagger op cache hit ratio  | LogQL: `count("CACHED") / count("CACHED                                                         | EXEC")` over 1h | 98%              | ≥ 95%            | ≥ 95% |

Cache hit ratio is the regression canary — a drop signals the git-URL refactor accidentally busted a cache key (e.g. by including a non-deterministic input).

## Critical files

| File                                                                                     | What changes                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scripts/ci/src/lib/buildkite.ts`                                                        | Add `REPO_GIT_URL`/`REPO_GIT_REF`/`gitDir()`/`gitFile()`. PR2: delete `plainStep`. |
| `scripts/ci/src/lib/k8s-plugin.ts`                                                       | `checkout: { skip: true }`, drop git-mirrors mount                                 |
| `scripts/ci/src/steps/per-package.ts`                                                    | `daggerPkgFlags()` → git-URL refs. Convert iOS native-deps step.                   |
| `scripts/ci/src/steps/{cooklang,helm,npm,images,sites,release,tofu,version,ci-image}.ts` | `./packages/X` → `gitDir(...)`, `--source .` → `--source ${REPO_GIT_REF}`          |
| `scripts/ci/src/steps/quality.ts`                                                        | PR2: every `plainStep(...)` → `daggerStep(...)` calling new Dagger fns             |
| `.dagger/src/quality.ts` (new)                                                           | PR2: 18 helper functions wrapping each plain-step's command                        |
| `.dagger/src/index.ts`                                                                   | PR2: 14 new `@func()` wrappers (Caddyfile + 17 = 18 total; one is iOS native-deps) |
| `.dagger/src/constants.ts`                                                               | PR2: pin TRIVY/SEMGREP/GITLEAKS/SHELLCHECK versions w/ Renovate annotations        |
| `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`                | PR2: remove `buildkite-git-mirrors` PVC + Helm default-checkout-params             |
| `.buildkite/pipeline.yml`                                                                | PR2: remove `buildkite-git-mirrors` volumeMount from bootstrap step                |
| `.buildkite/scripts/setup-tools.sh`                                                      | PR2: remove `install_{shellcheck,gitleaks,trivy,semgrep}`                          |

## Risks & mitigations

| Risk                                                                              | Mitigation                                                                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dagger CLI rejects URL-as-Directory syntax                                        | Phase 0 verification (1.1) gates this. Fallback: refactor `bunBaseContainer` to accept `commit: string` and call `dag.git()` internally.                        |
| Secrets not propagated to Dagger fns that today read env directly                 | Audit `.buildkite/scripts/{knip,trivy,semgrep}-check.sh` for `$VAR` refs. Plumb via `--token env:VAR` flag + `Secret` parameter on helper.                      |
| Annotation UX regression on Knip/Trivy/Semgrep                                    | `annotatedDaggerScan` preserves the exact flow. Smoke-PR forces a failure and verifies annotation appears.                                                      |
| Bootstrap pod's `git show FETCH_HEAD:.buildkite/ci-image/VERSION` fallback breaks | Already exists for PRs; unchanged here. Re-verify on next Renovate ci-base bump PR.                                                                             |
| `tasks-for-obsidian` iOS step needs CocoaPods environment                         | If conversion to Dagger fails, fall back to keeping just this one step on a legacy checkout-bearing `k8sPlugin` variant. Adds one if-branch in `k8s-plugin.ts`. |
| Dagger engine PVC fills faster post-refactor (more SHAs = more fetches)           | Monitor `kubelet_volume_stats_used_bytes{persistentvolumeclaim=~"dagger-engine.*"}` for 2 weeks post-PR2. **Tracked as separate work item** — see below.        |

**Rollback per PR**:

- **PR1**: revert `k8s-plugin.ts` to restore checkout. The git-URL flags in step generators continue working (Dagger accepts either form), so a partial revert of just the plugin file is sufficient.
- **PR2**: revert `steps/quality.ts` to its prior commit. New `.dagger/src/quality.ts` helpers remain unused but harmless.

## Out of scope — separate work items

1. **Dagger engine PVC capacity** (currently 75% full, 767/1024 GiB on `nvme0` ZFS). The git-URL refactor likely accelerates fill rate. Open separate item to (a) expand PVC, (b) configure `buildkitd.toml` GC policy, or (c) tighten `SOURCE_EXCLUDES` in `.dagger/src/constants.ts:117–133`. Do **not** bundle with this plan — it's an orthogonal capacity question on a different drive.

2. **Pipeline generator (`scripts/ci/src/main.ts`)** stays in a checkout-bearing bootstrap pod. One pod per build, ~1.3 GiB write — negligible. Convertible to Dagger later if architectural purity desired; not needed for the disk-pressure win.

3. **Buildkite Kueue `max-in-flight: 20` raise** — once nvme1 has headroom, this becomes a CPU/memory question. Lift after PR2 metrics confirm the model. Out of scope for this plan.
