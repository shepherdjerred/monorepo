/**
 * Assembles the full Buildkite pipeline from AffectedPackages.
 */
import {
  ALL_PACKAGES,
  IMAGE_PUSH_TARGETS,
  INFRA_PUSH_TARGETS,
  TOFU_STACKS,
} from "./catalog.ts";
import type { AffectedPackages } from "./lib/types.ts";
import type { PipelineStep, BuildkitePipeline } from "./lib/types.ts";
import { perPackageSteps } from "./steps/per-package.ts";
import {
  prettierStep,
  shellcheckStep,
  qualityRatchetStep,
  complianceCheckStep,
  knipCheckStep,
  gitleaksCheckStep,
  suppressionCheckStep,
  trivyScanStep,
  semgrepScanStep,
  daggerHygieneStep,
  caddyfileValidateStep,
  lockfileCheckStep,
  envVarNamesStep,
  migrationGuardStep,
  mergeConflictStep,
  largeFileStep,
} from "./steps/quality.ts";
import { codeReviewStep } from "./steps/code-review.ts";
import { releaseStep } from "./steps/release.ts";
import {
  publishImagesWithSmokeGroup,
  homelabImagesGroup,
  allPushKeys,
} from "./steps/images.ts";
import { publishNpmGroup, filterNpmPackages } from "./steps/npm.ts";
import {
  deploySitesGroup,
  filterSites,
  mkdocsDeployStep,
} from "./steps/sites.ts";
import { homelabHelmGroup } from "./steps/helm.ts";
import { homelabTofuGroup, homelabTofuPlanGroup } from "./steps/tofu.ts";
import { argoCdSyncStep, argoCdHealthStep } from "./steps/argocd.ts";
import { clauderonReleaseGroup } from "./steps/clauderon.ts";
import { cooklangReleaseGroup } from "./steps/cooklang.ts";
import { versionCommitBackStep } from "./steps/version.ts";
import { buildSummaryStep } from "./steps/build-summary.ts";
import { k8sPlugin } from "./lib/k8s-plugin.ts";

export function buildPipeline(affected: AffectedPackages): BuildkitePipeline {
  const steps: PipelineStep[] = [];

  // If nothing changed, emit a minimal pipeline
  if (!affected.buildAll && affected.packages.size === 0) {
    steps.push({
      label: ":white_check_mark: No changes detected",
      key: "no-changes",
      command: "echo 'No affected targets detected, nothing to build.'",
      plugins: [k8sPlugin()],
    });
    return { agents: { queue: "default" }, steps };
  }

  // --- Per-package build & test steps ---
  const packages = affected.buildAll
    ? ALL_PACKAGES.slice().sort()
    : [...affected.packages].sort();

  // Map package name → build group key (e.g. "birmel" → "pkg-birmel")
  // Used to scope downstream steps to their own package build only.
  const pkgKeyMap = new Map<string, string>();

  // Release depends only on repo-wide quality gates, NOT per-package builds.
  const releaseDeps: string[] = [];

  for (const pkg of packages) {
    const group = perPackageSteps(pkg);
    if (group) {
      steps.push(group);
      pkgKeyMap.set(pkg, group.key);
    }
  }

  // --- Quality gates (blocking — must pass before releases) ---
  const blockingGates = [
    lockfileCheckStep(),
    shellcheckStep(),
    qualityRatchetStep(),
    complianceCheckStep(),
    gitleaksCheckStep(),
    suppressionCheckStep(),
    envVarNamesStep(),
    migrationGuardStep(),
    mergeConflictStep(),
    largeFileStep(),
  ];
  for (const gate of blockingGates) {
    steps.push(gate);
    releaseDeps.push(gate.key);
  }

  // --- Async quality checks (soft_fail, run in parallel with release track) ---
  steps.push(prettierStep());
  steps.push(knipCheckStep());
  steps.push(daggerHygieneStep());
  steps.push(trivyScanStep());
  steps.push(semgrepScanStep());

  // --- Caddyfile validation (blocking, only when homelab changes) ---
  if (affected.buildAll || affected.homelabChanged) {
    const caddyStep = caddyfileValidateStep();
    steps.push(caddyStep);
    releaseDeps.push(caddyStep.key);
  }

  // --- Code Review (PRs only) ---
  const prNumber = process.env["BUILDKITE_PULL_REQUEST"] ?? "false";
  if (prNumber !== "false" && prNumber !== "" && prNumber !== undefined) {
    steps.push(codeReviewStep());
  }

  // --- Main-only steps ---
  const hasMainSteps =
    affected.buildAll ||
    affected.hasImagePackages.size > 0 ||
    affected.hasSitePackages.size > 0 ||
    affected.hasNpmPackages.size > 0 ||
    affected.homelabChanged ||
    affected.clauderonChanged ||
    affected.cooklangChanged;

  if (hasMainSteps) {
    // Release depends only on repo-wide quality gates.
    // Per-package builds gate their own downstream steps, not release.
    // Async checks (trivy, semgrep, knip, prettier, dagger-hygiene) run in parallel.
    steps.push(releaseStep(releaseDeps));

    // Helper: build deps array scoped to release + a specific package build
    const scopedDeps = (pkg: string, extra: string[] = []): string[] => {
      const deps = ["release", ...extra];
      const pkgKey = pkgKeyMap.get(pkg);
      if (pkgKey) deps.push(pkgKey);
      return deps;
    };

    // --- Publish app images (with smoke tests for images that have health endpoints) ---
    const hasImages = affected.buildAll || affected.hasImagePackages.size > 0;
    let appPushKeys: string[] = [];
    if (hasImages) {
      steps.push(publishImagesWithSmokeGroup(IMAGE_PUSH_TARGETS, pkgKeyMap));
      appPushKeys = allPushKeys(IMAGE_PUSH_TARGETS);
    }

    // --- Publish NPM packages ---
    if (affected.buildAll || affected.hasNpmPackages.size > 0) {
      const npmToPublish = filterNpmPackages(
        affected.hasNpmPackages,
        affected.buildAll,
      );
      if (npmToPublish.length > 0) {
        steps.push(publishNpmGroup(npmToPublish, pkgKeyMap));
      }
    }

    // --- Clauderon Release ---
    if (affected.buildAll || affected.clauderonChanged) {
      steps.push(clauderonReleaseGroup(pkgKeyMap.get("clauderon")));
    }

    // --- Cooklang Release ---
    if (affected.buildAll || affected.cooklangChanged) {
      steps.push(cooklangReleaseGroup(pkgKeyMap.get("cooklang-rich-preview")));
    }

    // --- Deploy sites ---
    if (affected.buildAll || affected.hasSitePackages.size > 0) {
      const sitesToDeploy = filterSites(
        affected.hasSitePackages,
        affected.buildAll,
      );
      steps.push(deploySitesGroup(sitesToDeploy, pkgKeyMap));
    }

    // --- MkDocs deploy (discord-plays-pokemon docs, needs Python not Bun) ---
    if (affected.buildAll || affected.packages.has("discord-plays-pokemon")) {
      steps.push(mkdocsDeployStep(scopedDeps("discord-plays-pokemon")));
    }

    // --- Homelab Tofu Plan (runs on PRs for early feedback) ---
    if (affected.buildAll || affected.homelabChanged) {
      steps.push(homelabTofuPlanGroup());
    }

    // --- Homelab release track ---
    if (affected.buildAll || affected.homelabChanged) {
      const homelabPkgKey = pkgKeyMap.get("homelab");

      // Homelab infra images (4 parallel)
      steps.push(homelabImagesGroup(homelabPkgKey));
      const infraPushKeys = allPushKeys(INFRA_PUSH_TARGETS);

      // Homelab Helm: cdk8s build -> helm chart push
      steps.push(homelabHelmGroup(infraPushKeys, homelabPkgKey));

      // Homelab Tofu: 3 parallel stacks
      steps.push(homelabTofuGroup(homelabPkgKey));
    }

    // --- Unified ArgoCD sync (depends on whatever upstream steps ran) ---
    const needsArgoSync =
      hasImages || affected.buildAll || affected.homelabChanged;
    if (needsArgoSync) {
      const argocdDeps: string[] = [];
      if (hasImages) {
        argocdDeps.push(...appPushKeys);
      }
      if (affected.buildAll || affected.homelabChanged) {
        argocdDeps.push(
          "homelab-helm-push",
          ...TOFU_STACKS.map((s) => `tofu-${s}`),
        );
      }
      steps.push(
        argoCdSyncStep(argocdDeps, { key: "deploy-argocd", app: "apps" }),
      );
      steps.push(
        argoCdHealthStep("deploy-argocd", {
          key: "argocd-health",
          app: "apps",
        }),
      );
    }

    // --- Version Commit-Back ---
    if (
      affected.buildAll ||
      affected.hasImagePackages.size > 0 ||
      affected.homelabChanged
    ) {
      const vcbDeps: string[] = [];
      if (hasImages) {
        vcbDeps.push(...appPushKeys);
      }
      if (affected.buildAll || affected.homelabChanged) {
        vcbDeps.push(...allPushKeys(INFRA_PUSH_TARGETS));
      }
      steps.push(versionCommitBackStep(vcbDeps));
    }

    // --- Build Summary ---
    // Collect all terminal step keys so the summary runs last
    const summaryDeps: string[] = ["release"];
    if (hasImages) summaryDeps.push(...appPushKeys);
    if (needsArgoSync) {
      summaryDeps.push("argocd-health");
    }
    steps.push(buildSummaryStep(summaryDeps));
  }

  return { agents: { queue: "default" }, steps };
}
