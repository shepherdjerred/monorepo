/**
 * Renovate fast-track classification.
 *
 * Recognizes the file-change patterns Renovate produces (per-package manifests,
 * lockfiles, version files) so a dependency-bump PR can be scoped precisely
 * instead of triggering a full build.
 */
import { ALL_PACKAGES } from "../catalog.ts";

/**
 * Packages that are NOT JavaScript/TypeScript — excluded from the "all-js"
 * Renovate classification (root package.json changes).
 */
export const NON_JS_PACKAGES = new Set([
  "terraform-provider-asuswrt", // Go
  "resume", // LaTeX
]);

/** All JS/TS workspace packages (ALL_PACKAGES minus non-JS). */
export const JS_TS_PACKAGES = ALL_PACKAGES.filter(
  (p) => !NON_JS_PACKAGES.has(p),
);

/** Check if the current build is a Renovate pull request. */
export function isRenovatePr(): boolean {
  const email = Bun.env["BUILDKITE_BUILD_AUTHOR_EMAIL"] ?? "";
  const pr = Bun.env["BUILDKITE_PULL_REQUEST"] ?? "false";
  return email.includes("renovate[bot]") && pr !== "false";
}

export type RenovateClassification =
  | { kind: "noop" }
  | { kind: "scoped"; packages: Set<string> }
  | { kind: "all-js" }
  | null;

/**
 * Classify changed files in a Renovate PR.
 * Returns null if any file doesn't match a known Renovate pattern
 * (falls through to normal detection).
 *
 * Priority: null > scoped > noop
 */
export function classifyRenovateFiles(
  changedFiles: string[],
): RenovateClassification {
  let level: "noop" | "scoped" = "noop";
  const scopedPackages = new Set<string>();

  for (const f of changedFiles) {
    // Version files — pure string value changes, nothing to test
    if (f.endsWith("/versions.ts") || f.endsWith("/lib-versions.ts")) {
      continue; // stays at current level (noop or higher)
    }

    // Per-package manifest, lockfile, or Dockerfile
    if (f.startsWith("packages/")) {
      const rest = f.slice("packages/".length);
      const pkg = rest.split("/")[0];
      if (!pkg) return null;

      const relPath = rest.slice(pkg.length + 1);
      if (
        relPath === "package.json" ||
        relPath === "bun.lock" ||
        relPath === "package-lock.json" ||
        relPath === "Dockerfile"
      ) {
        scopedPackages.add(pkg);
        if (level === "noop") level = "scoped";
        continue;
      }

      // Unknown file under packages/ — not a recognized Renovate pattern
      return null;
    }

    // Root bun.lock — derivative of manifest changes, ignore
    if (f === "bun.lock") {
      continue;
    }

    // Root package.json — only contains markdownlint-cli2 dev tool, not consumed by any
    // workspace package; if real shared workspace deps are ever added here, revisit this.
    if (f === "package.json") {
      continue;
    }

    // CI tool versions — string value bumps, nothing to test
    if (f === ".buildkite/scripts/setup-tools.sh") {
      continue;
    }

    // Dagger manifest/lockfile — tool version bumps (npm, typescript in Dagger runtime);
    // actual pipeline logic lives in .dagger/src/ which falls through correctly.
    if (
      f === ".dagger/package.json" ||
      f === ".dagger/bun.lock" ||
      f === ".dagger/package-lock.json"
    ) {
      continue;
    }

    // Anything else is unrecognized — fall through to normal detection
    return null;
  }

  if (level === "scoped") return { kind: "scoped", packages: scopedPackages };
  return { kind: "noop" };
}

// Aliases for the test surface (same-file re-declaration exports).
export {
  isRenovatePr as _isRenovatePr,
  classifyRenovateFiles as _classifyRenovateFiles,
  NON_JS_PACKAGES as _NON_JS_PACKAGES,
  JS_TS_PACKAGES as _JS_TS_PACKAGES,
};
