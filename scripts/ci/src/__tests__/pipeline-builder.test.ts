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
    hasImagePackages: new Set(),
    hasSitePackages: new Set(),
    hasNpmPackages: new Set(),
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
    hasImagePackages: new Set(PACKAGES_WITH_IMAGES),
    hasSitePackages: new Set(Object.keys(PACKAGE_TO_SITE)),
    hasNpmPackages: new Set(PACKAGES_WITH_NPM),
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
    it("returns a minimal pipeline with no-changes step", () => {
      const pipeline = buildPipeline(emptyAffected());
      expect(pipeline.steps).toHaveLength(1);
      const step = pipeline.steps[0]!;
      expect(isStep(step)).toBe(true);
      if (isStep(step)) {
        expect(step.key).toBe("no-changes");
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

    it("release step depends only on quality gates, not per-package builds", () => {
      const pipeline = buildPipeline(fullBuild());

      // No wait steps — release uses explicit depends_on
      const waits = pipeline.steps.filter(isWait);
      expect(waits).toHaveLength(0);

      // Release step exists with depends_on
      const steps = pipeline.steps.filter(isStep);
      const release = steps.find((s) => s.key === "release");
      expect(release).toBeDefined();
      expect(Array.isArray(release?.depends_on)).toBe(true);
      const deps = release?.depends_on;
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

      expect(groupKeys).toContain("build-homelab-images");
      expect(groupKeys).toContain("push-homelab-images");
      expect(groupKeys).toContain("homelab-helm-push");
      expect(groupKeys).toContain("homelab-tofu");
    });

    it("includes version commit-back", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "version-commit-back")).toBe(true);
    });

    it("includes build summary step with allow_dependency_failure", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      const summary = steps.find((s) => s.key === "build-summary");
      expect(summary).toBeDefined();
      expect(summary?.depends_on).toBeDefined();
      expect(summary?.allow_dependency_failure).toBe(true);
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

  describe("homelab-only change", () => {
    it("includes homelab track and images but not clauderon or cooklang", () => {
      const affected = emptyAffected();
      affected.packages.add("homelab");
      affected.homelabChanged = true;

      const pipeline = buildPipeline(affected);
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);

      expect(groupKeys).toContain("build-homelab-images");
      expect(groupKeys).toContain("push-homelab-images");
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
  });
});
