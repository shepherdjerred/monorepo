/**
 * Quality gate step generators.
 *
 * Every step in this file is a `daggerStep` that runs an `@func()` from
 * `.dagger/src/quality.ts` against `${REPO_GIT_REF}`. The Dagger engine
 * fetches source server-side, content-addressed by SHA — the BK pod itself
 * writes no source to disk.
 *
 * The one exception is `greptileReviewStep`, a `plainStep` that runs repo
 * scripts + `buildkite-agent` on the agent (so it keeps the agent-side
 * checkout / `buildkite-git-mirrors` mount via `k8sPluginWithCheckout`). All
 * other steps are Dagger git-URL refs per the BK-pressure reduction plan
 * (`packages/docs/plans/2026-05-31_bk-dagger-git-url-refactor.md`).
 */
import {
  daggerStep,
  plainStep,
  REPO_GIT_REF,
  DAGGER_CALL,
} from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

/**
 * Wrap a Dagger scanner call so its output is teed to a file and posted to
 * the build page via `buildkite-agent annotate` on non-zero exit. Used by
 * Knip / Trivy / Semgrep — annotation lifecycle stays BK-side because
 * `buildkite-agent` is only available in the agent pod.
 */
function annotatedDaggerScan(
  daggerFn: string,
  context: string,
  annotationStyle: "error" | "warning" = "warning",
): string {
  const outFile = `/tmp/${context}.txt`;
  return [
    `set -o pipefail`,
    `${DAGGER_CALL} ${daggerFn} --source ${REPO_GIT_REF} 2>&1 | tee ${outFile}`,
    `status=$$?`,
    `if [ $$status -ne 0 ] && [ -s ${outFile} ]; then buildkite-agent annotate --style ${annotationStyle} --context ${context} < ${outFile}; fi`,
    `exit $$status`,
  ].join("; ");
}

/**
 * Bundled quality gate: one BK pod runs 15 source-only blocking checks in
 * parallel via `qualityBundle` (Dagger `Promise.all` on sibling containers).
 * Replaces a fan-out of 15 separate `daggerStep` calls. Bundle wall time is
 * the slowest child; pod count drops from 15 to 1.
 *
 * Checks NOT included (stay as their own step): `knip-check`, `trivy-scan`,
 * `semgrep-scan` (each needs per-context BK annotation lifecycle),
 * `large-file-check`, `dagger-hygiene` (soft-fail, kept separate for
 * granular soft-fail tracking), `greptile-review` (PR-only),
 * `caddyfile-validate`, `tunnel-dns-coverage`, `talos-schematic-sync` (each
 * gated by file change-detection), `bun-lock-drift-check` (runtime `--seeds`
 * arg derived from change-detection).
 */
export function qualityBundleStep(): BuildkiteStep {
  return daggerStep({
    label: ":shield: Quality Bundle (15 checks)",
    key: "quality-bundle",
    daggerCmd: `${DAGGER_CALL} quality-bundle --source ${REPO_GIT_REF}`,
    timeoutMinutes: 15,
  });
}

export function knipCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":scissors: Knip",
    key: "knip-check",
    daggerCmd: annotatedDaggerScan("knip-check", "knip"),
    timeoutMinutes: 10,
    softFail: true,
    artifactPaths: ["/tmp/knip.txt"],
  });
}

export function trivyScanStep(): BuildkiteStep {
  return daggerStep({
    label: ":shield: Trivy Scan",
    key: "trivy-scan",
    daggerCmd: annotatedDaggerScan("trivy-scan", "trivy"),
    timeoutMinutes: 15,
    softFail: true,
    artifactPaths: ["/tmp/trivy.txt"],
  });
}

/**
 * Bundled soft-fail step: dagger-hygiene + large-file-check in one BK pod.
 * Replaces two separate soft-fail BK steps with one. Both children today
 * run unconditionally, so the bundle does too.
 */
export function softFailBundleStep(): BuildkiteStep {
  return daggerStep({
    label: ":broom::warning: Soft-fail Bundle (hygiene + large-file)",
    key: "soft-fail-bundle",
    daggerCmd: `${DAGGER_CALL} soft-fail-bundle --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
    softFail: true,
  });
}

/**
 * Verifies every cdk8s `TunnelBinding` has a matching
 * `cloudflare_dns_record` in Tofu. Without DNS, the tunnel hostname silently
 * fails to resolve — see prReview/prSummary outage on 2026-05-02.
 */
export function tunnelDnsCoverageStep(): BuildkiteStep {
  return daggerStep({
    label: ":cloud: Tunnel DNS Coverage",
    key: "tunnel-dns-coverage",
    daggerCmd: `${DAGGER_CALL} tunnel-dns-coverage --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

/**
 * Verifies the pinned Talos installer in `patches/image.yaml` matches what the
 * `image.yaml` schematic produces (queries the Image Factory). Drift means the
 * node boots a stale schematic — e.g. silently dropping `lockdown=integrity`,
 * which breaks eBPF profiling. See the 2026-06-13 talos/k8s upgrade log.
 */
export function talosSchematicSyncStep(): BuildkiteStep {
  return daggerStep({
    label: ":talos: Talos Schematic Sync",
    key: "talos-schematic-sync",
    daggerCmd: `${DAGGER_CALL} talos-schematic-sync --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function semgrepScanStep(): BuildkiteStep {
  return daggerStep({
    label: ":mag: Semgrep Scan",
    key: "semgrep-scan",
    daggerCmd: annotatedDaggerScan("semgrep-scan", "semgrep"),
    timeoutMinutes: 15,
    softFail: true,
    artifactPaths: ["/tmp/semgrep.txt"],
  });
}

/**
 * Per-package `bun.lock` drift gate — takes the directly-changed seed
 * packages, expands the `file:`-dep reverse closure inside the script (using
 * a **nested-workspace-aware** graph), then runs `bun install
 * --frozen-lockfile --dry-run` across the closure. Catches the class of
 * drift where a Renovate PR regenerates one workspace's `bun.lock` but
 * leaves a `file:`-dependent workspace's `bun.lock` stale (see PR #1213 →
 * discord-plays-pokemon post-mortem). Pairs with `lockfileCheckStep`, which
 * only validates the root `bun.lock`.
 *
 * Why seeds (not the pre-computed closure): the CI change detector's
 * `transitiveClosure` reads only top-level `packages/<X>/package.json`, so a
 * `file:` edge declared in a nested workspace (e.g. dpp's
 * `packages/backend/package.json` depending on `llm-observability`) is
 * invisible to it. Passing the raw seeds and re-expanding in-script with a
 * nested-aware graph fixes that miss.
 */
export function bunLockDriftCheckStep(seeds: string[]): BuildkiteStep {
  const list = seeds.slice().sort().join(",");
  return daggerStep({
    label: ":lock: Lockfile Drift Check",
    key: "bun-lock-drift-check",
    daggerCmd: `${DAGGER_CALL} bun-lock-drift-check --source ${REPO_GIT_REF} --seeds ${list}`,
    timeoutMinutes: 5,
  });
}

/**
 * PR-only gate: waits for Greptile to finish reviewing the head commit, then
 * passes only once every Greptile review comment on the latest revision is
 * resolved. Fails fast (with the list of unresolved comments) otherwise — see
 * `scripts/ci/src/wait-for-greptile.ts`. Greptile's own status check is NOT
 * sufficient: it goes green when the review completes, regardless of whether
 * the comments were addressed.
 */
export function greptileReviewStep(): BuildkiteStep {
  return plainStep({
    label: ":mag: Greptile Review",
    key: "greptile-review",
    command: [
      'echo "+++ :mag: Greptile Review"',
      'export GH_TOKEN="$(bun packages/temporal/src/lib/github-app-token.ts)"',
      'test -n "$$GH_TOKEN"',
      "bun scripts/ci/src/wait-for-greptile.ts",
    ].join(" && "),
    timeoutMinutes: 25,
  });
}

export function caddyfileValidateStep(): BuildkiteStep {
  return daggerStep({
    label: ":globe_with_meridians: Caddyfile Validate",
    key: "caddyfile-validate",
    daggerCmd: `${DAGGER_CALL} caddyfile-validate --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

// extract-versions step removed — all artifacts now use $BUILDKITE_BUILD_NUMBER
// or Dagger-internal version resolution. See decisions/2026-04-04_unified-versioning-strategy.md
