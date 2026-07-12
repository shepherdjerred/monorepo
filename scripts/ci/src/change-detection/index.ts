/**
 * Git-diff based change detection with failed-build retry.
 *
 * Determines which packages changed and need to be built. This module is the
 * public entry point: it declares the `detectChanges` orchestrator that composes
 * the fast-tracks (Renovate, version commit-back, cooklang commit-back), the
 * infra full-build check, and the normal package-mapping + transitive-closure
 * path. Supporting logic lives in the sibling modules (git-diff,
 * buildkite-queries, renovate, special-cases, version-commit, result-builders).
 */
import { ALL_PACKAGES } from "../catalog.ts";
import type { AffectedPackages } from "../lib/types.ts";
import {
  getChangedFiles,
  readWorkspaceDeps,
  transitiveClosure,
} from "./git-diff.ts";
import {
  classifyRenovateFiles,
  isRenovatePr,
  JS_TS_PACKAGES,
} from "./renovate.ts";
import {
  buildScopedResult,
  emptyResult,
  fullBuildResult,
} from "./result-builders.ts";
import {
  checkCiImageChanges,
  checkCiImageVersionChanges,
  checkHelmTypesInputChanges,
  checkInfraChanges,
  checkTofuChanges,
  extractPackageName,
} from "./special-cases.ts";
import {
  hasCooklangSourceChange,
  isCooklangVersionCommitBack,
  isCooklangVersionCommitBackOnly,
  isVersionCommitBack,
} from "./version-commit.ts";

export async function detectChanges(): Promise<AffectedPackages> {
  const forceFullEnv = (Bun.env["FULL_BUILD"] ?? "").toLowerCase() === "true";
  const commitMsg = Bun.env["BUILDKITE_MESSAGE"] ?? "";
  const forceFull = forceFullEnv || commitMsg.includes("[full-build]");

  if (forceFull) {
    // A forced full build rebuilds/retests everything but never publishes
    // cooklang — change a cooklang source file to cut a plugin release.
    console.error("Full build requested, building everything");
    return fullBuildResult(false);
  }

  const changedFiles = await getChangedFiles();
  const cooklangSourceChanged = hasCooklangSourceChange(changedFiles);
  const tofuChanged = checkTofuChanges(changedFiles);
  // Over-triggers on any versions.ts change (it mixes image + chart versions),
  // but never under-triggers on a chart bump — correctness over a little extra
  // runtime. Image-digest commit-backs go through the version-commit-back path
  // below, which keeps the default `false`.
  const helmTypesInputsChanged = checkHelmTypesInputChanges(changedFiles);

  // Renovate fast-track: runs BEFORE infra check so that bun.lock/package.json
  // in INFRA_FILES don't short-circuit the fast path.
  if (isRenovatePr()) {
    const classification = classifyRenovateFiles(changedFiles);
    if (classification !== null) {
      console.error(`Renovate fast-track: ${classification.kind}`);

      if (classification.kind === "noop") {
        if (helmTypesInputsChanged) {
          // versions.ts is a HELM_TYPES_INPUT_FILE — a Renovate chart-bump PR that
          // only touches versions.ts still needs the drift-check step so that the CI
          // gate fires on chart-version bumps (the main use-case this PR was built to
          // cover). Include "homelab" in the packages set so that the per-package loop
          // in buildPipeline runs for homelab and emits the drift-check step via
          // perPackageSteps("homelab", helmTypesInputsChanged=true). An empty set would
          // hit the early-return guard in buildPipeline and skip the drift check.
          console.error(
            "Renovate noop, but helmTypesInputsChanged=true — emitting drift-check step for homelab",
          );
          return buildScopedResult({
            allAffected: new Set(["homelab"]),
            // No top-level package files changed (only versions.ts); the
            // drift gate has nothing to expand from. The closure {homelab} is
            // still emitted to drive the helm-types drift step.
            directlyChanged: new Set(),
            cooklangChanged: false,
            ciImageChanged: false,
            helmTypesInputsChanged: true,
          });
        }
        console.error("Renovate: no builds needed");
        return emptyResult();
      }

      // Seed directly-changed packages from classification, then fall through
      // to transitive closure + flag derivation below.
      const directlyChanged = new Set<string>();
      if (classification.kind === "scoped") {
        for (const pkg of classification.packages) {
          if (ALL_PACKAGES.includes(pkg)) {
            directlyChanged.add(pkg);
          }
        }
      } else {
        // all-js
        for (const pkg of JS_TS_PACKAGES) {
          directlyChanged.add(pkg);
        }
      }

      const depGraph = await readWorkspaceDeps();
      const allAffected = transitiveClosure(directlyChanged, depGraph);

      console.error(
        `Renovate affected packages (${String(allAffected.size)}):`,
      );
      for (const p of [...allAffected].sort()) {
        console.error(`  ${p}`);
      }

      return buildScopedResult({
        allAffected,
        directlyChanged,
        cooklangChanged: cooklangSourceChanged,
        ciImageChanged: false,
        tofuChanged,
        helmTypesInputsChanged,
      });
    }

    // classification === null: unrecognized files, fall through to normal detection
    console.error(
      "Renovate PR with unrecognized files, using normal detection",
    );
  }

  // Version commit-back fast-track: prevents infinite loop where
  // version-commit-back → merge → build → images → version-commit-back.
  // The new digests still need to flow through cdk8s synth → Helm push → ArgoCD,
  // but image builds and another version-commit-back must be skipped.
  if (isVersionCommitBack()) {
    const classification = classifyRenovateFiles(changedFiles);
    if (classification !== null && classification.kind === "noop") {
      console.error(
        "Version commit-back: skipping image builds, running deploy pipeline",
      );
      const result = buildScopedResult({
        allAffected: new Set(["homelab"]),
        // Version commit-back touches only versions.ts; no top-level
        // package.json/bun.lock changes for the drift gate to seed from.
        directlyChanged: new Set(),
        cooklangChanged: cooklangSourceChanged,
        ciImageChanged: false,
        tofuChanged,
      });
      result.versionBumpOnly = true;
      return result;
    }
    console.error(
      "Version commit-back with non-trivial changes, using normal detection",
    );
  }

  // Cooklang commit-back fast-track: the publish step already released the
  // plugin and opened this metadata bump. Do not publish again from the bump.
  if (isCooklangVersionCommitBack()) {
    if (isCooklangVersionCommitBackOnly(changedFiles)) {
      console.error(
        "Cooklang version commit-back: skipping cooklang release pipeline",
      );
      return emptyResult();
    }
    console.error(
      "Cooklang version commit-back with non-trivial changes, using normal detection",
    );
  }

  // Normal detection: check infrastructure files
  const infraChanged = checkInfraChanges(changedFiles);
  if (infraChanged) {
    console.error("Infrastructure files changed, building everything");
    return fullBuildResult(cooklangSourceChanged);
  }

  // Map changed files to packages
  const directlyChanged = new Set<string>();
  for (const f of changedFiles) {
    const pkg = extractPackageName(f);
    if (pkg !== null && ALL_PACKAGES.includes(pkg)) {
      directlyChanged.add(pkg);
    }
  }

  const ciImageChanged = checkCiImageChanges(changedFiles);
  const ciImageVersionChanged = checkCiImageVersionChanges(changedFiles);

  if (directlyChanged.size === 0 && !ciImageChanged && !ciImageVersionChanged) {
    console.error("No affected packages detected");
    return emptyResult();
  }

  // Compute transitive closure via workspace dependency graph
  const depGraph = await readWorkspaceDeps();
  const allAffected = transitiveClosure(directlyChanged, depGraph);

  console.error(`Affected packages (${String(allAffected.size)}):`);
  for (const p of [...allAffected].sort()) {
    console.error(`  ${p}`);
  }

  return buildScopedResult({
    allAffected,
    directlyChanged,
    cooklangChanged: cooklangSourceChanged,
    ciImageChanged,
    ciImageVersionChanged,
    tofuChanged,
    helmTypesInputsChanged,
  });
}
