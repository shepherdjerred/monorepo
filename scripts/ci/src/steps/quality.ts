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

export function prettierStep(): BuildkiteStep {
  return daggerStep({
    label: ":art: Prettier",
    key: "prettier",
    daggerCmd: `${DAGGER_CALL} prettier --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function markdownlintStep(): BuildkiteStep {
  return daggerStep({
    label: ":pencil: Markdownlint",
    key: "markdownlint",
    daggerCmd: `${DAGGER_CALL} markdownlint --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function shellcheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":shell: Shellcheck",
    key: "shellcheck",
    daggerCmd: `${DAGGER_CALL} shellcheck --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function qualityRatchetStep(): BuildkiteStep {
  return daggerStep({
    label: ":chart_with_upwards_trend: Quality Ratchet",
    key: "quality-ratchet",
    daggerCmd: `${DAGGER_CALL} quality-ratchet --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function complianceCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":clipboard: Compliance Check",
    key: "compliance-check",
    daggerCmd: `${DAGGER_CALL} compliance-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
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

export function gitleaksCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":lock: Gitleaks",
    key: "gitleaks-check",
    daggerCmd: `${DAGGER_CALL} gitleaks-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function suppressionCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":no_entry_sign: Suppression Check",
    key: "suppression-check",
    daggerCmd: `${DAGGER_CALL} suppression-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
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

export function daggerHygieneStep(): BuildkiteStep {
  return daggerStep({
    label: ":broom: Dagger Hygiene",
    key: "dagger-hygiene",
    daggerCmd: `${DAGGER_CALL} dagger-hygiene --source ${REPO_GIT_REF}`,
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

/**
 * Verifies `react`/`react-dom` (and their `@types`) resolve to matching
 * versions in every `bun.lock`. A skew throws "Incompatible React versions" at
 * runtime — invisible to typecheck/build/test. See the mariokart.sjer.red
 * post-mortem in packages/docs/plans.
 */
export function reactVersionSyncStep(): BuildkiteStep {
  return daggerStep({
    label: ":react: React Version Sync",
    key: "react-version-sync",
    daggerCmd: `${DAGGER_CALL} react-version-sync --source ${REPO_GIT_REF}`,
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

export function lockfileCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":lock: Lockfile Check",
    key: "lockfile-check",
    daggerCmd: `${DAGGER_CALL} lockfile-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 5,
  });
}

export function envVarNamesStep(): BuildkiteStep {
  return daggerStep({
    label: ":label: Env Var Names",
    key: "env-var-names",
    daggerCmd: `${DAGGER_CALL} env-var-names --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

/**
 * Verifies every tracked file's index line endings match its `.gitattributes`
 * declaration. Catches the class of bug from renovate-481 where a file with
 * mixed CRLF/LF leaked into a Unix-only path and nothing flagged it pre-merge.
 */
export function lineEndingsCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":scroll: Line Endings",
    key: "line-endings-check",
    daggerCmd: `${DAGGER_CALL} line-endings-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 5,
  });
}

/**
 * Verify Scout's committed SQLite test template matches migrations + seeds.
 * Migrated to Dagger in PR2 of the BK-pressure plan.
 */
export function scoutTestTemplateCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":floppy_disk: Scout Test Template",
    key: "scout-test-template-check",
    daggerCmd: `${DAGGER_CALL} scout-test-template-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

export function migrationGuardStep(): BuildkiteStep {
  return daggerStep({
    label: ":shield: Migration Guard",
    key: "migration-guard",
    daggerCmd: `${DAGGER_CALL} migration-guard --source ${REPO_GIT_REF}`,
    timeoutMinutes: 10,
  });
}

/**
 * Enforce the TODO source-marker → docs invariant (`scripts/check-todos.ts`).
 * Runs in lefthook pre-commit; this gate makes it a CI merge requirement too,
 * so a `--no-verify` commit can't slip an untracked marker past CI.
 */
export function checkTodosStep(): BuildkiteStep {
  return daggerStep({
    label: ":clipboard: Check TODOs",
    key: "check-todos",
    daggerCmd: `${DAGGER_CALL} check-todos --source ${REPO_GIT_REF}`,
    timeoutMinutes: 5,
  });
}

export function mergeConflictStep(): BuildkiteStep {
  return daggerStep({
    label: ":no_entry: Merge Conflict Check",
    key: "merge-conflict-check",
    daggerCmd: `${DAGGER_CALL} merge-conflict-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 5,
  });
}

/**
 * Surfaces files >5 MB so they can be moved to LFS or removed. **Soft-fail**:
 * findings are surfaced as annotations but do not block the build.
 */
export function largeFileStep(): BuildkiteStep {
  return daggerStep({
    label: ":warning: Large File Check",
    key: "large-file-check",
    daggerCmd: `${DAGGER_CALL} large-file-check --source ${REPO_GIT_REF}`,
    timeoutMinutes: 5,
    softFail: true,
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
