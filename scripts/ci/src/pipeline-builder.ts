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
} from "./steps/quality.ts";
import { codeReviewStep } from "./steps/code-review.ts";
import { releaseStep } from "./steps/release.ts";
import {
  publishImagesGroup,
  homelabImagesGroup,
  allPushKeys,
} from "./steps/images.ts";
import { publishNpmGroup } from "./steps/npm.ts";
import { deploySitesGroup, filterSites } from "./steps/sites.ts";
import { homelabHelmGroup } from "./steps/helm.ts";
import { homelabTofuGroup } from "./steps/tofu.ts";
import { argoCdSyncStep, argoCdHealthStep } from "./steps/argocd.ts";
import { clauderonReleaseGroup } from "./steps/clauderon.ts";
import { cooklangReleaseGroup } from "./steps/cooklang.ts";
import { versionCommitBackStep } from "./steps/version.ts";
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

  for (const pkg of packages) {
    const group = perPackageSteps(pkg);
    if (group) steps.push(group);
  }

  // --- Quality gates (blocking — must pass before releases) ---
  steps.push(shellcheckStep());
  steps.push(qualityRatchetStep());
  steps.push(complianceCheckStep());
  steps.push(gitleaksCheckStep());
  steps.push(suppressionCheckStep());

  // --- Quality checks (non-blocking — run in parallel, don't gate releases) ---
  steps.push(prettierStep());
  steps.push(knipCheckStep());
  steps.push(trivyScanStep());
  steps.push(semgrepScanStep());

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
    affected.homelabChanged ||
    affected.clauderonChanged ||
    affected.cooklangChanged;

  if (hasMainSteps) {
    // Wait for all build/test to pass before release steps
    steps.push({ wait: "", if: "build.branch == pipeline.default_branch" });

    // Release (always on main when there are releasable changes)
    steps.push(releaseStep());

    // --- Publish app images ---
    const hasImages = affected.buildAll || affected.hasImagePackages.size > 0;
    let appPushKeys: string[] = [];
    if (hasImages) {
      steps.push(publishImagesGroup(IMAGE_PUSH_TARGETS));
      appPushKeys = allPushKeys(IMAGE_PUSH_TARGETS);
    }

    // --- Publish NPM packages ---
    steps.push(publishNpmGroup());

    // --- Clauderon Release ---
    if (affected.buildAll || affected.clauderonChanged) {
      steps.push(clauderonReleaseGroup());
    }

    // --- Cooklang Release ---
    if (affected.buildAll || affected.cooklangChanged) {
      steps.push(cooklangReleaseGroup());
    }

    // --- Deploy sites ---
    if (affected.buildAll || affected.hasSitePackages.size > 0) {
      const sitesToDeploy = filterSites(
        affected.hasSitePackages,
        affected.buildAll,
      );
      const deployDeps = appPushKeys.length > 0 ? appPushKeys : ["release"];
      steps.push(deploySitesGroup(sitesToDeploy, deployDeps));
    }

    // --- Deploy ArgoCD sync (for app images) ---
    if (hasImages) {
      steps.push(argoCdSyncStep(appPushKeys));
    }

    // --- Homelab release track ---
    if (affected.buildAll || affected.homelabChanged) {
      // Homelab infra images (4 parallel)
      steps.push(homelabImagesGroup());
      const infraPushKeys = allPushKeys(INFRA_PUSH_TARGETS);

      // Homelab Helm: cdk8s build -> helm chart push
      steps.push(homelabHelmGroup(infraPushKeys));

      // Homelab Tofu: 3 parallel stacks
      steps.push(homelabTofuGroup());

      // Homelab ArgoCD sync (depends on helm push + all tofu stacks)
      const argocdDeps = [
        "homelab-helm-push",
        ...TOFU_STACKS.map((s) => `tofu-${s}`),
      ];
      steps.push(
        argoCdSyncStep(argocdDeps, {
          key: "homelab-argocd-sync",
          app: "apps",
        }),
      );

      // Wait for ArgoCD healthy
      steps.push(
        argoCdHealthStep("homelab-argocd-sync", {
          key: "homelab-argocd-health",
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
  }

  return { agents: { queue: "default" }, steps };
}
