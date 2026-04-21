import { describe, expect, it } from "bun:test";
import { buildPipeline } from "../pipeline-builder.ts";
import type { AffectedPackages } from "../lib/types.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import {
  ALL_PACKAGES,
  PACKAGES_WITH_IMAGES,
  PACKAGES_WITH_NPM,
  PACKAGE_TO_SITE,
  SKIP_PACKAGES,
} from "../catalog.ts";

function emptyAffected(): AffectedPackages {
  return {
    packages: new Set(),
    buildAll: false,
    homelabChanged: false,
    clauderonChanged: false,
    cooklangChanged: false,
    castleCastersChanged: false,
    resumeChanged: false,
    ciImageChanged: false,
    hasImagePackages: new Set(),
    hasSitePackages: new Set(),
    hasNpmPackages: new Set(),
    versionBumpOnly: false,
    releasePleaseMerge: false,
  };
}

function fullBuild(): AffectedPackages {
  return {
    packages: new Set(ALL_PACKAGES),
    buildAll: true,
    homelabChanged: true,
    clauderonChanged: true,
    cooklangChanged: true,
    castleCastersChanged: true,
    resumeChanged: true,
    ciImageChanged: true,
    hasImagePackages: new Set(PACKAGES_WITH_IMAGES),
    hasSitePackages: new Set(Object.keys(PACKAGE_TO_SITE)),
    hasNpmPackages: new Set(PACKAGES_WITH_NPM),
    versionBumpOnly: false,
    releasePleaseMerge: false,
  };
}

function isGroup(step: unknown): step is BuildkiteGroup {
  return typeof step === "object" && step !== null && "group" in step;
}

function isStep(step: unknown): step is BuildkiteStep {
  return (
    typeof step === "object" &&
    step !== null &&
    "label" in step &&
    !("group" in step) &&
    !("wait" in step)
  );
}

function isWait(step: unknown): step is { wait: string } {
  return typeof step === "object" && step !== null && "wait" in step;
}

describe("buildPipeline", () => {
  describe("no changes", () => {
    it("returns a minimal pipeline with no-changes and ci-complete steps", () => {
      const pipeline = buildPipeline(emptyAffected());
      expect(pipeline.steps).toHaveLength(2);
      const noChanges = pipeline.steps[0]!;
      expect(isStep(noChanges)).toBe(true);
      if (isStep(noChanges)) {
        expect(noChanges.key).toBe("no-changes");
      }
      const ciComplete = pipeline.steps[1]!;
      expect(isStep(ciComplete)).toBe(true);
      if (isStep(ciComplete)) {
        expect(ciComplete.key).toBe("ci-complete");
        expect(ciComplete.depends_on).toEqual(["no-changes"]);
      }
    });
  });

  describe("single package change", () => {
    it("emits only that package's group plus quality gates", () => {
      const affected = emptyAffected();
      affected.packages.add("webring");

      const pipeline = buildPipeline(affected);

      const groups = pipeline.steps.filter(isGroup);
      const pkgGroups = groups.filter((g) => g.key.startsWith("pkg-"));
      expect(pkgGroups).toHaveLength(1);
      expect(pkgGroups[0]!.key).toBe("pkg-webring");
    });

    it("does not include release steps for non-main", () => {
      const affected = emptyAffected();
      affected.packages.add("webring");

      const pipeline = buildPipeline(affected);
      const waits = pipeline.steps.filter(isWait);
      expect(waits).toHaveLength(0);
    });

    it("includes ci-complete step depending on quality gates and package build", () => {
      const affected = emptyAffected();
      affected.packages.add("webring");

      const pipeline = buildPipeline(affected);
      const steps = pipeline.steps.filter(isStep);
      const ciComplete = steps.find((s) => s.key === "ci-complete");
      expect(ciComplete).toBeDefined();
      const deps = Array.isArray(ciComplete?.depends_on)
        ? ciComplete.depends_on
        : [];
      // Should include the package build group
      expect(deps).toContain("pkg-webring");
      // Should include blocking quality gates
      expect(deps).toContain("lockfile-check");
      expect(deps).toContain("shellcheck");
    });

    it("includes async quality checks even without main steps", () => {
      const affected = emptyAffected();
      affected.packages.add("webring");

      const pipeline = buildPipeline(affected);
      const steps = pipeline.steps.filter(isStep);
      // All async checks should be present
      for (const key of [
        "prettier",
        "knip-check",
        "dagger-hygiene",
        "trivy-scan",
        "semgrep-scan",
      ]) {
        expect(steps.find((s) => s.key === key)).toBeDefined();
      }
      // These specific checks should be soft_fail
      for (const key of [
        "knip-check",
        "dagger-hygiene",
        "trivy-scan",
        "semgrep-scan",
      ]) {
        expect(steps.find((s) => s.key === key)?.soft_fail).toBe(true);
      }
    });
  });

  describe("full build", () => {
    it("includes all packages", () => {
      const pipeline = buildPipeline(fullBuild());
      const pkgGroups = pipeline.steps
        .filter(isGroup)
        .filter((g) => g.key.startsWith("pkg-"));
      expect(pkgGroups.length).toBe(ALL_PACKAGES.length - SKIP_PACKAGES.size);
    });

    it("includes quality gates", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      const qualityKeys = [
        "prettier",
        "shellcheck",
        "quality-ratchet",
        "compliance-check",
        "knip-check",
        "gitleaks-check",
        "suppression-check",
      ];
      for (const key of qualityKeys) {
        expect(steps.some((s) => s.key === key)).toBe(true);
      }
    });

    it("includes security and quality scans with soft_fail", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      for (const key of [
        "semgrep-scan",
        "trivy-scan",
        "dagger-hygiene",
        "knip-check",
      ]) {
        const step = steps.find((s) => s.key === key);
        expect(step).toBeDefined();
        expect(step?.soft_fail).toBe(true);
      }
    });

    it("quality gate depends only on quality checks, not per-package builds", () => {
      const pipeline = buildPipeline(fullBuild());

      // No wait steps — quality-gate uses explicit depends_on
      const waits = pipeline.steps.filter(isWait);
      expect(waits).toHaveLength(0);

      // Quality gate step exists with depends_on
      const steps = pipeline.steps.filter(isStep);
      const gate = steps.find((s) => s.key === "quality-gate");
      expect(gate).toBeDefined();
      expect(Array.isArray(gate?.depends_on)).toBe(true);
      const deps = gate?.depends_on;
      expect(Array.isArray(deps) ? deps : []).not.toHaveLength(0);

      // depends_on does NOT include per-package group keys
      const pkgGroups = pipeline.steps
        .filter(isGroup)
        .filter((g) => g.key.startsWith("pkg-"));
      for (const g of pkgGroups) {
        expect(Array.isArray(deps) ? deps : []).not.toContain(g.key);
      }

      // depends_on includes blocking quality gate keys
      const blockingGateKeys = [
        "shellcheck",
        "quality-ratchet",
        "compliance-check",
        "gitleaks-check",
        "suppression-check",
        "env-var-names",
        "migration-guard",
        "merge-conflict-check",
        "large-file-check",
        "caddyfile-validate",
      ];
      for (const key of blockingGateKeys) {
        expect(Array.isArray(deps) ? deps : []).toContain(key);
      }

      // depends_on does NOT include async (soft_fail) check keys
      const asyncKeys = [
        "prettier",
        "knip-check",
        "dagger-hygiene",
        "trivy-scan",
        "semgrep-scan",
      ];
      for (const key of asyncKeys) {
        expect(Array.isArray(deps) ? deps : []).not.toContain(key);
      }
    });

    it("smoke tests gate image pushes (smoke before push)", () => {
      const pipeline = buildPipeline(fullBuild());
      const allSteps: BuildkiteStep[] = [];

      function collect(steps: unknown[]) {
        for (const s of steps) {
          if (isStep(s)) allSteps.push(s);
          if (
            typeof s === "object" &&
            s !== null &&
            "steps" in s &&
            Array.isArray((s as Record<string, unknown>)["steps"])
          ) {
            collect((s as Record<string, unknown>)["steps"] as unknown[]);
          }
        }
      }
      collect(pipeline.steps);

      // Smoke tests depend on their build step
      const smokeSteps = allSteps.filter((s) => s.key.startsWith("smoke-"));
      expect(smokeSteps.length).toBeGreaterThan(0);
      for (const s of smokeSteps) {
        const deps = Array.isArray(s.depends_on)
          ? s.depends_on
          : [s.depends_on];
        const imgName = s.key.replace("smoke-", "");
        expect(deps).toContain(`build-${imgName}`);
      }

      // Push steps with smoke tests depend on their smoke step
      for (const smoke of smokeSteps) {
        const imgName = smoke.key.replace("smoke-", "");
        const push = allSteps.find((s) => s.key === `push-${imgName}`);
        expect(push).toBeDefined();
        const pushDeps = Array.isArray(push?.depends_on)
          ? push?.depends_on
          : [push?.depends_on];
        expect(pushDeps).toContain(smoke.key);
      }

      // Push steps without smoke tests depend on their build step
      const smokeNames = new Set(
        smokeSteps.map((s) => s.key.replace("smoke-", "")),
      );
      const pushOnly = allSteps.filter(
        (s) =>
          s.key.startsWith("push-") &&
          !smokeNames.has(s.key.replace("push-", "")),
      );
      for (const s of pushOnly) {
        const deps = Array.isArray(s.depends_on)
          ? s.depends_on
          : [s.depends_on];
        const imgName = s.key.replace("push-", "");
        expect(deps).toContain(`build-${imgName}`);
      }
    });

    it("tofu plan steps are PR-only", () => {
      const pipeline = buildPipeline(fullBuild());
      const allSteps: BuildkiteStep[] = [];

      function collect(steps: unknown[]) {
        for (const s of steps) {
          if (isStep(s)) allSteps.push(s);
          if (
            typeof s === "object" &&
            s !== null &&
            "steps" in s &&
            Array.isArray((s as Record<string, unknown>)["steps"])
          ) {
            collect((s as Record<string, unknown>)["steps"] as unknown[]);
          }
        }
      }
      collect(pipeline.steps);

      const planSteps = allSteps.filter((s) => s.key.startsWith("tofu-plan-"));
      expect(planSteps.length).toBeGreaterThan(0);
      for (const s of planSteps) {
        expect(s.if).toBe("build.branch != pipeline.default_branch");
      }
    });

    it("includes image build/push, npm, clauderon, cooklang, and sites groups", () => {
      const pipeline = buildPipeline(fullBuild());
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);

      expect(groupKeys).toContain("build-images");
      expect(groupKeys).toContain("push-images");
      expect(groupKeys).toContain("publish-npm");
      expect(groupKeys).toContain("clauderon-build");
      expect(groupKeys).toContain("cooklang-release");
      expect(groupKeys).toContain("deploy-sites");
    });

    it("includes homelab track", () => {
      const pipeline = buildPipeline(fullBuild());
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);

      // Homelab images are now part of the unified build/push groups
      expect(groupKeys).toContain("build-images");
      expect(groupKeys).toContain("push-images");
      expect(groupKeys).toContain("homelab-helm-push");
      expect(groupKeys).toContain("homelab-tofu");
    });

    it("includes version commit-back", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "version-commit-back")).toBe(true);
    });

    it("includes ci-complete step in full build", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      const ciComplete = steps.find((s) => s.key === "ci-complete");
      expect(ciComplete).toBeDefined();
      const deps = Array.isArray(ciComplete?.depends_on)
        ? ciComplete.depends_on
        : [];
      // Should include blocking quality gates
      expect(deps).toContain("lockfile-check");
      expect(deps).toContain("shellcheck");
      // Should include per-package build keys
      expect(deps.some((d: string) => d.startsWith("pkg-"))).toBe(true);
    });

    it("includes build summary step with allow_dependency_failure", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      const summary = steps.find((s) => s.key === "build-summary");
      expect(summary).toBeDefined();
      expect(summary?.depends_on).toBeDefined();
      expect(summary?.allow_dependency_failure).toBe(true);
    });

    it("build summary command emits escaped backticks, no ${BT} leakage", () => {
      // Regression test: build 1011 failed with `/bin/sh: ghcr: parameter not set`
      // because the generator emitted `$$${BT}` which collapsed to a bare `$` once
      // Buildkite stripped `${BT}` as an unset env var. Ensure the new form survives
      // Buildkite's variable interpolation and produces literal backticks in bash.
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      const summary = steps.find((s) => s.key === "build-summary");
      const command =
        typeof summary?.command === "string"
          ? summary.command
          : (summary?.command ?? []).join("\n");
      expect(command).toContain("\\`ghcr.io/");
      expect(command).toContain("\\`$$DIGEST\\`");
      expect(command).not.toContain("${BT}");
      expect(command).not.toContain("BT=");
      // After Buildkite $$ -> $ expansion the surviving markdown code span uses \`.
      const postBuildkite = command.replace(/\$\$/g, "$");
      expect(postBuildkite).toMatch(/\\`ghcr\.io\/[^`]+:\$VERSION\\`/);
      expect(postBuildkite).toMatch(/\\`\$DIGEST\\`/);
    });

    it("deploy steps have concurrency groups", () => {
      const pipeline = buildPipeline(fullBuild());
      const allSteps: BuildkiteStep[] = [];

      function collect(steps: unknown[]) {
        for (const s of steps) {
          if (isStep(s)) allSteps.push(s);
          if (
            typeof s === "object" &&
            s !== null &&
            "steps" in s &&
            Array.isArray((s as Record<string, unknown>)["steps"])
          ) {
            collect((s as Record<string, unknown>)["steps"] as unknown[]);
          }
        }
      }
      collect(pipeline.steps);

      const tofuSteps = allSteps.filter((s) => s.key.startsWith("tofu-"));
      expect(tofuSteps.length).toBeGreaterThan(0);
      for (const s of tofuSteps) {
        expect(s.concurrency).toBe(1);
        expect(s.concurrency_group).toContain("monorepo/tofu-");
      }

      const argoSteps = allSteps.filter((s) =>
        s.key.startsWith("deploy-argocd"),
      );
      expect(argoSteps.length).toBeGreaterThan(0);
      for (const s of argoSteps) {
        expect(s.concurrency).toBe(1);
        expect(s.concurrency_group).toContain("monorepo/argocd-sync-");
      }
    });
  });

  describe("version-bump-only (commit-back)", () => {
    function versionBumpAffected(): AffectedPackages {
      const affected = emptyAffected();
      affected.packages.add("homelab");
      affected.homelabChanged = true;
      affected.versionBumpOnly = true;
      return affected;
    }

    it("includes cdk8s synth so new digests are rendered into manifests", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "homelab-cdk8s")).toBe(true);
    });

    it("includes helm chart push so ArgoCD picks up new manifests", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const groups = pipeline.steps.filter(isGroup);
      expect(groups.some((g) => g.key === "homelab-helm-push")).toBe(true);
    });

    it("includes tofu apply", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const groups = pipeline.steps.filter(isGroup);
      expect(groups.some((g) => g.key === "homelab-tofu")).toBe(true);
    });

    it("includes ArgoCD sync and health check", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "deploy-argocd")).toBe(true);
      expect(steps.some((s) => s.key === "argocd-health")).toBe(true);
    });

    it("does NOT build any images (they were already pushed)", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const groups = pipeline.steps.filter(isGroup);
      expect(groups.some((g) => g.key === "build-images")).toBe(false);
    });

    it("does NOT push any images", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const groups = pipeline.steps.filter(isGroup);
      expect(groups.some((g) => g.key === "push-images")).toBe(false);
    });

    it("does NOT run version-commit-back (breaks the loop)", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "version-commit-back")).toBe(false);
    });

    it("does NOT include unrelated packages (clauderon, cooklang, npm, sites)", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);
      expect(groupKeys).not.toContain("clauderon-build");
      expect(groupKeys).not.toContain("cooklang-release");
      expect(groupKeys).not.toContain("publish-npm");
      expect(groupKeys).not.toContain("deploy-sites");
    });

    it("ArgoCD sync depends on helm and tofu, not image pushes", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const steps = pipeline.steps.filter(isStep);
      const argoSync = steps.find((s) => s.key === "deploy-argocd");
      expect(argoSync).toBeDefined();
      const deps = Array.isArray(argoSync?.depends_on)
        ? argoSync.depends_on
        : [];
      expect(deps).toContain("homelab-helm-push");
      // Should NOT depend on any push-* image keys
      const imagePushDeps = deps.filter((d: string) => d.startsWith("push-"));
      expect(imagePushDeps).toHaveLength(0);
    });

    it("has valid depends_on references (no dangling refs to skipped image steps)", () => {
      const pipeline = buildPipeline(versionBumpAffected());
      const allKeys = new Set<string>();
      const allDeps: string[] = [];

      function collect(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s !== "object" || s === null) continue;
          const obj = s as Record<string, unknown>;
          if (typeof obj["key"] === "string") allKeys.add(obj["key"]);
          if (typeof obj["depends_on"] === "string")
            allDeps.push(obj["depends_on"]);
          if (Array.isArray(obj["depends_on"])) {
            for (const d of obj["depends_on"]) {
              if (typeof d === "string") allDeps.push(d);
            }
          }
          if (Array.isArray(obj["steps"])) collect(obj["steps"] as unknown[]);
        }
      }

      collect(pipeline.steps);

      const missing = allDeps.filter((d) => !allKeys.has(d));
      expect(missing).toEqual([]);
    });
  });

  describe("homelab-only change", () => {
    it("includes homelab track and images but not clauderon or cooklang", () => {
      const affected = emptyAffected();
      affected.packages.add("homelab");
      affected.homelabChanged = true;

      const pipeline = buildPipeline(affected);
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);

      // Homelab images are part of the unified build/push groups
      expect(groupKeys).toContain("build-images");
      expect(groupKeys).toContain("push-images");
      expect(groupKeys).toContain("homelab-helm-push");
      expect(groupKeys).toContain("homelab-tofu");
      expect(groupKeys).not.toContain("clauderon-build");
      expect(groupKeys).not.toContain("cooklang-release");
    });
  });

  describe("structural validation", () => {
    it("has unique step keys across the full build", () => {
      const pipeline = buildPipeline(fullBuild());
      const keys: string[] = [];

      function collectKeys(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s === "object" && s !== null) {
            if (
              "key" in s &&
              typeof (s as Record<string, unknown>)["key"] === "string"
            ) {
              keys.push((s as Record<string, unknown>)["key"] as string);
            }
            if (
              "steps" in s &&
              Array.isArray((s as Record<string, unknown>)["steps"])
            ) {
              collectKeys((s as Record<string, unknown>)["steps"] as unknown[]);
            }
          }
        }
      }

      collectKeys(pipeline.steps);

      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const k of keys) {
        if (seen.has(k)) dupes.push(k);
        seen.add(k);
      }

      expect(dupes).toEqual([]);
    });

    it("has valid depends_on references in full build", () => {
      const pipeline = buildPipeline(fullBuild());
      const allKeys = new Set<string>();
      const allDeps: string[] = [];

      function collect(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s !== "object" || s === null) continue;
          const obj = s as Record<string, unknown>;
          if (typeof obj["key"] === "string") allKeys.add(obj["key"]);
          if (typeof obj["depends_on"] === "string")
            allDeps.push(obj["depends_on"]);
          if (Array.isArray(obj["depends_on"])) {
            for (const d of obj["depends_on"]) {
              if (typeof d === "string") allDeps.push(d);
            }
          }
          if (Array.isArray(obj["steps"])) collect(obj["steps"] as unknown[]);
        }
      }

      collect(pipeline.steps);

      const missing = allDeps.filter((d) => !allKeys.has(d));
      expect(missing).toEqual([]);
    });

    it("all commands use dagger call or are known plain steps", () => {
      const pipeline = buildPipeline(fullBuild());
      /** Steps that intentionally run directly on the agent (no Dagger). */
      const PLAIN_STEP_KEYS = new Set([
        "lockfile-check",
        "quality-ratchet",
        "compliance-check",
        "env-var-names",
        "migration-guard",
        "dagger-hygiene",
        "merge-conflict-check",
        "large-file-check",
        "prettier",
        "shellcheck",
        "knip-check",
        "gitleaks-check",
        "suppression-check",
        "trivy-scan",
        "semgrep-scan",
      ]);
      const nonDagger: string[] = [];

      function check(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s !== "object" || s === null) continue;
          const obj = s as Record<string, unknown>;
          if (typeof obj["command"] === "string") {
            const cmd = obj["command"] as string;
            const key = obj["key"];
            if (
              !cmd.includes("dagger call") &&
              !cmd.includes("echo ") &&
              !cmd.includes("buildkite-agent") &&
              !(typeof key === "string" && PLAIN_STEP_KEYS.has(key))
            ) {
              nonDagger.push(`${key}: ${cmd}`);
            }
          }
          if (Array.isArray(obj["steps"])) check(obj["steps"] as unknown[]);
        }
      }

      check(pipeline.steps);
      expect(nonDagger).toEqual([]);
    });

    it("every K8s plugin has _EXPERIMENTAL_DAGGER_RUNNER_HOST", () => {
      const pipeline = buildPipeline(fullBuild());
      let pluginCount = 0;
      let hasRunnerHost = 0;

      function check(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s !== "object" || s === null) continue;
          const obj = s as Record<string, unknown>;
          if (Array.isArray(obj["plugins"])) {
            for (const p of obj["plugins"]) {
              if (typeof p === "object" && p !== null && "kubernetes" in p) {
                pluginCount++;
                const json = JSON.stringify(p);
                if (json.includes("_EXPERIMENTAL_DAGGER_RUNNER_HOST")) {
                  hasRunnerHost++;
                }
              }
            }
          }
          if (Array.isArray(obj["steps"])) check(obj["steps"] as unknown[]);
        }
      }

      check(pipeline.steps);
      expect(pluginCount).toBeGreaterThan(0);
      expect(hasRunnerHost).toBe(pluginCount);
    });

    it("has unique step keys in release-please merge full build", () => {
      const affected = fullBuild();
      affected.releasePleaseMerge = true;
      const pipeline = buildPipeline(affected);
      const keys: string[] = [];

      function collectKeys(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s === "object" && s !== null) {
            if (
              "key" in s &&
              typeof (s as Record<string, unknown>)["key"] === "string"
            ) {
              keys.push((s as Record<string, unknown>)["key"] as string);
            }
            if (
              "steps" in s &&
              Array.isArray((s as Record<string, unknown>)["steps"])
            ) {
              collectKeys((s as Record<string, unknown>)["steps"] as unknown[]);
            }
          }
        }
      }

      collectKeys(pipeline.steps);

      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const k of keys) {
        if (seen.has(k)) dupes.push(k);
        seen.add(k);
      }

      expect(dupes).toEqual([]);
    });
  });

  describe("release-please merge", () => {
    function releasePleaseAffected(): AffectedPackages {
      const affected = fullBuild();
      affected.releasePleaseMerge = true;
      return affected;
    }

    it("generates both prod and dev npm publish steps", () => {
      const pipeline = buildPipeline(releasePleaseAffected());
      const groups = pipeline.steps.filter(isGroup);
      const npmGroup = groups.find((g) => g.key === "publish-npm");
      expect(npmGroup).toBeDefined();
      const steps = npmGroup!.steps;
      // Should have prod + dev for each npm package (3 packages × 2 = 6 steps)
      expect(steps.length).toBe(6);
      const prodSteps = steps.filter((s) => s.key.endsWith("-prod"));
      const devSteps = steps.filter((s) => !s.key.endsWith("-prod"));
      expect(prodSteps.length).toBe(3);
      expect(devSteps.length).toBe(3);
    });

    it("prod steps do not have --dev-suffix flag", () => {
      const pipeline = buildPipeline(releasePleaseAffected());
      const groups = pipeline.steps.filter(isGroup);
      const npmGroup = groups.find((g) => g.key === "publish-npm");
      const prodSteps = npmGroup!.steps.filter((s) => s.key.endsWith("-prod"));
      for (const step of prodSteps) {
        expect(step.command).not.toContain("--dev-suffix");
      }
    });

    it("dev steps have --dev-suffix flag", () => {
      const pipeline = buildPipeline(releasePleaseAffected());
      const groups = pipeline.steps.filter(isGroup);
      const npmGroup = groups.find((g) => g.key === "publish-npm");
      const devSteps = npmGroup!.steps.filter((s) => !s.key.endsWith("-prod"));
      for (const step of devSteps) {
        expect(step.command).toContain("--dev-suffix");
      }
    });
  });
});
