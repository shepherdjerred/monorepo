/**
 * Quality gate step generators: prettier, shellcheck, compliance, ratchet, knip, gitleaks.
 */
import { daggerStep } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

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
    daggerCmd: "dagger call knip-check --source .",
    timeoutMinutes: 10,
    softFail: true,
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
    daggerCmd: "dagger call trivy-scan --source .",
    timeoutMinutes: 15,
    softFail: true,
  });
}

export function daggerHygieneStep(): BuildkiteStep {
  return daggerStep({
    label: ":broom: Dagger Hygiene",
    key: "dagger-hygiene",
    daggerCmd: "dagger call dagger-hygiene --source .",
    timeoutMinutes: 10,
  });
}

export function semgrepScanStep(): BuildkiteStep {
  return daggerStep({
    label: ":mag: Semgrep Scan",
    key: "semgrep-scan",
    daggerCmd: "dagger call semgrep-scan --source .",
    timeoutMinutes: 15,
    softFail: true,
  });
}
