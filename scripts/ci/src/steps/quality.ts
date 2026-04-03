/**
 * Quality gate step generators: prettier, shellcheck, compliance, ratchet, knip, gitleaks.
 */
import { daggerStep } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

/** Wraps a dagger command to tee output and annotate the build page on failure. */
function annotatedScanCmd(daggerCmd: string, context: string): string {
  const outFile = `/tmp/${context}.txt`;
  return [
    `set -o pipefail`,
    `${daggerCmd} 2>&1 | tee ${outFile}`,
    `status=$?`,
    `if [ $status -ne 0 ] && [ -s ${outFile} ]; then buildkite-agent annotate --style warning --context ${context} < ${outFile}; fi`,
    `exit $status`,
  ].join("; ");
}

export function prettierStep(): BuildkiteStep {
  return daggerStep({
    label: ":art: Prettier",
    key: "prettier",
    daggerCmd: "dagger call prettier --source .",
    timeoutMinutes: 10,
    softFail: true,
  });
}

export function shellcheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":shell: Shellcheck",
    key: "shellcheck",
    daggerCmd: "dagger call shellcheck --source .",
    timeoutMinutes: 10,
  });
}

export function qualityRatchetStep(): BuildkiteStep {
  return daggerStep({
    label: ":chart_with_upwards_trend: Quality Ratchet",
    key: "quality-ratchet",
    daggerCmd: "dagger call quality-ratchet --source .",
    timeoutMinutes: 10,
  });
}

export function complianceCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":clipboard: Compliance Check",
    key: "compliance-check",
    daggerCmd: "dagger call compliance-check --source .",
    timeoutMinutes: 10,
  });
}

export function knipCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":scissors: Knip",
    key: "knip-check",
    daggerCmd: annotatedScanCmd("dagger call knip-check --source .", "knip"),
    timeoutMinutes: 10,
    softFail: true,
    artifactPaths: ["/tmp/knip.txt"],
  });
}

export function gitleaksCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":lock: Gitleaks",
    key: "gitleaks-check",
    daggerCmd: "dagger call gitleaks-check --source .",
    timeoutMinutes: 10,
  });
}

export function suppressionCheckStep(): BuildkiteStep {
  return daggerStep({
    label: ":no_entry_sign: Suppression Check",
    key: "suppression-check",
    daggerCmd: "dagger call suppression-check --source .",
    timeoutMinutes: 10,
  });
}

export function trivyScanStep(): BuildkiteStep {
  return daggerStep({
    label: ":shield: Trivy Scan",
    key: "trivy-scan",
    daggerCmd: annotatedScanCmd("dagger call trivy-scan --source .", "trivy"),
    timeoutMinutes: 15,
    softFail: true,
    artifactPaths: ["/tmp/trivy.txt"],
  });
}

export function daggerHygieneStep(): BuildkiteStep {
  return daggerStep({
    label: ":broom: Dagger Hygiene",
    key: "dagger-hygiene",
    daggerCmd: "dagger call dagger-hygiene --source .",
    timeoutMinutes: 10,
    softFail: true,
  });
}

export function semgrepScanStep(): BuildkiteStep {
  return daggerStep({
    label: ":mag: Semgrep Scan",
    key: "semgrep-scan",
    daggerCmd: annotatedScanCmd(
      "dagger call semgrep-scan --source .",
      "semgrep",
    ),
    timeoutMinutes: 15,
    softFail: true,
    artifactPaths: ["/tmp/semgrep.txt"],
  });
}

export function envVarNamesStep(): BuildkiteStep {
  return daggerStep({
    label: ":label: Env Var Names",
    key: "env-var-names",
    daggerCmd: "dagger call env-var-names --source .",
    timeoutMinutes: 10,
  });
}

export function migrationGuardStep(): BuildkiteStep {
  return daggerStep({
    label: ":shield: Migration Guard",
    key: "migration-guard",
    daggerCmd: "dagger call migration-guard --source .",
    timeoutMinutes: 10,
  });
}

export function mergeConflictStep(): BuildkiteStep {
  return daggerStep({
    label: ":no_entry: Merge Conflict Check",
    key: "merge-conflict-check",
    daggerCmd: "dagger call merge-conflict-check --source .",
    timeoutMinutes: 5,
  });
}

export function largeFileStep(): BuildkiteStep {
  return daggerStep({
    label: ":warning: Large File Check",
    key: "large-file-check",
    daggerCmd: "dagger call large-file-check --source .",
    timeoutMinutes: 5,
  });
}

export function caddyfileValidateStep(): BuildkiteStep {
  return daggerStep({
    label: ":globe_with_meridians: Caddyfile Validate",
    key: "caddyfile-validate",
    daggerCmd: "dagger call caddyfile-validate --source .",
    timeoutMinutes: 10,
  });
}
