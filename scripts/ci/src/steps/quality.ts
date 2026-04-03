/**
 * Quality gate step generators: prettier, shellcheck, compliance, ratchet, knip, gitleaks.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { daggerStep, plainStep } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

/** Resolve a path relative to the monorepo root (4 levels up from this file). */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** Read an ignore file (one entry per line, # comments, blank lines skipped). */
function readIgnoreFile(path: string): string[] {
  const fullPath = resolve(REPO_ROOT, path);
  if (!existsSync(fullPath)) return [];
  return readFileSync(fullPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

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

/** Plain step: only needs bun (in ci-base). Reads .quality-baseline.json and counts suppressions. */
export function qualityRatchetStep(): BuildkiteStep {
  return plainStep({
    label: ":chart_with_upwards_trend: Quality Ratchet",
    key: "quality-ratchet",
    command: "bun scripts/quality-ratchet.ts",
  });
}

/** Plain step: only needs bash (in ci-base). Checks all packages have required scripts. */
export function complianceCheckStep(): BuildkiteStep {
  return plainStep({
    label: ":clipboard: Compliance Check",
    key: "compliance-check",
    command: "bash scripts/compliance-check.sh",
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

/** Plain step: only needs bun (in ci-base). Greps for banned patterns in CI code. */
export function daggerHygieneStep(): BuildkiteStep {
  return plainStep({
    label: ":broom: Dagger Hygiene",
    key: "dagger-hygiene",
    command: "bun scripts/check-dagger-hygiene.ts",
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

/** Plain step: only needs bash+grep+git (in ci-base). Validates env var naming conventions. */
export function envVarNamesStep(): BuildkiteStep {
  return plainStep({
    label: ":label: Env Var Names",
    key: "env-var-names",
    command: [
      "files=$(git ls-files --",
      "'*.ts' '*.rs' '*.py' '*.fish' '*.tmpl' '*.yaml' '*.yml'",
      "'*.env' '*.md' '*.sh' '*.swift'",
      "':!:archive/' ':!:practice/' ':!:.dagger/' ':!:.build/' ':!:**/generated/*')",
      "&& bash scripts/check-env-var-names.sh $files",
    ].join(" "),
  });
}

/** Plain step: only needs bun (in ci-base). Guards against package exclusions. */
export function migrationGuardStep(): BuildkiteStep {
  return plainStep({
    label: ":shield: Migration Guard",
    key: "migration-guard",
    command: "bun scripts/guard-no-package-exclusions.ts",
  });
}

/** Plain step: only needs grep (in ci-base). Detects unresolved merge conflict markers. */
export function mergeConflictStep(): BuildkiteStep {
  const ignored = readIgnoreFile(".conflictignore");
  const filterPipe =
    ignored.length > 0 ? ignored.map((p) => `| grep -v '${p}'`).join(" ") : "";
  return plainStep({
    label: ":no_entry: Merge Conflict Check",
    key: "merge-conflict-check",
    command: [
      "files=$(grep -rl '<<<<<<< \\|>>>>>>> '",
      "--include='*.ts' --include='*.tsx' --include='*.rs'",
      "--include='*.json' --include='*.yaml' --include='*.yml'",
      "--include='*.md' --include='*.sh'",
      "--exclude-dir=node_modules --exclude-dir=.dagger",
      `--exclude=lefthook.yml . ${filterPipe} || true)`,
      '&& if [ -n "$files" ]; then echo "Merge conflict markers found:" && echo "$files" && exit 1; fi',
    ].join(" "),
    timeoutMinutes: 5,
  });
}

/** Plain step: only needs find (in ci-base). Detects files exceeding 5MB. */
export function largeFileStep(): BuildkiteStep {
  const ignoreExclusions = readIgnoreFile(".largeignore").map(
    (p) => `-not -path "./${p}"`,
  );
  return plainStep({
    label: ":warning: Large File Check",
    key: "large-file-check",
    command: [
      "large=$(find . -type f -size +5M",
      '-not -path "*/node_modules/*" -not -path "*/.git/*"',
      '-not -path "*/.build/*" -not -path "*/.dagger/*"',
      '-not -path "*/archive/*"',
      ...ignoreExclusions,
      "-exec ls -lh {} +)",
      '&& if [ -n "$large" ]; then echo "Files exceed 5MB limit:" && echo "$large" && exit 1; fi',
    ].join(" "),
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
