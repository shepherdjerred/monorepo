/**
 * Special-case file classifiers.
 *
 * Each predicate answers a narrow "did files of kind X change?" question that
 * gates a specific pipeline behaviour (full build, CI-image rebuild, tofu plan,
 * helm-types drift check) or maps a path back to its owning package.
 */

/** Files that, if changed, trigger a full build. */
const INFRA_FILES = new Set([
  "bun.lock",
  "package.json",
  "tsconfig.json",
  "tsconfig.base.json",
]);

/** Directory prefixes that, if any file under them changes, trigger a full build. */
const INFRA_DIRS = [".buildkite/", ".dagger/", "scripts/ci/"];

/** Paths under INFRA_DIRS that should NOT trigger a full build. */
const INFRA_DIR_EXCLUSIONS = [".buildkite/ci-image/"];

export function checkInfraChanges(changedFiles: string[]): boolean {
  for (const f of changedFiles) {
    if (INFRA_FILES.has(f)) {
      console.error(`Infrastructure file changed: ${f}`);
      return true;
    }
    for (const d of INFRA_DIRS) {
      if (f.startsWith(d)) {
        if (INFRA_DIR_EXCLUSIONS.some((ex) => f.startsWith(ex))) continue;
        console.error(`Infrastructure dir changed: ${f}`);
        return true;
      }
    }
  }
  return false;
}

export function checkCiImageChanges(changedFiles: string[]): boolean {
  for (const f of changedFiles) {
    if (
      f.startsWith(".buildkite/ci-image/") &&
      f !== ".buildkite/ci-image/VERSION"
    ) {
      console.error(`CI image changed: ${f}`);
      return true;
    }
  }
  return false;
}

export function checkCiImageVersionChanges(changedFiles: string[]): boolean {
  return changedFiles.includes(".buildkite/ci-image/VERSION");
}

/**
 * True when an OpenTofu source file changed. Gates the PR tofu *plan* group so
 * that cdk8s-only homelab PRs don't run (and queue behind) tofu plans that
 * produce no signal for them. Changes to the tofu Dagger logic (`.dagger/`) or
 * the CI generator (`scripts/ci/`) trigger a full build instead, which runs the
 * plan via `buildAll`.
 */
export function checkTofuChanges(changedFiles: string[]): boolean {
  return changedFiles.some((f) => f.startsWith("packages/homelab/src/tofu/"));
}

/**
 * Inputs that change what `generate-helm-types` emits: the pinned chart
 * versions, the generator/parser scripts, and the helm-types library. When any
 * of these change we run the `helm-types-drift-check` gate (regenerate + diff vs
 * committed). Scoped narrowly so the ~24-chart network fetch only runs on PRs
 * that can actually change the generated tree — not on every homelab/cdk8s edit.
 *
 * Prettier/formatting drift of the committed tree is intentionally NOT included:
 * the repo-wide `prettier --check` gate already catches that.
 */
const HELM_TYPES_INPUT_FILES = new Set([
  "packages/homelab/src/cdk8s/src/versions.ts",
  "packages/homelab/src/cdk8s/scripts/generate-helm-types.ts",
  "packages/homelab/src/cdk8s/scripts/parse-helm-charts.ts",
]);

export function checkHelmTypesInputChanges(changedFiles: string[]): boolean {
  return changedFiles.some(
    (f) =>
      HELM_TYPES_INPUT_FILES.has(f) ||
      f.startsWith("packages/homelab/src/helm-types/"),
  );
}

export function extractPackageName(filePath: string): string | null {
  if (!filePath.startsWith("packages/")) return null;
  const rest = filePath.slice("packages/".length);
  const parts = rest.split("/");
  return parts[0] ?? null;
}

// Aliases for the test surface (same-file re-declaration exports).
export {
  checkInfraChanges as _checkInfraChanges,
  checkCiImageChanges as _checkCiImageChanges,
  checkCiImageVersionChanges as _checkCiImageVersionChanges,
  checkTofuChanges as _checkTofuChanges,
  checkHelmTypesInputChanges as _checkHelmTypesInputChanges,
  extractPackageName as _extractPackageName,
};
