import { describe, expect, it } from "bun:test";
import { buildPipeline } from "../pipeline-builder.ts";
import type { AffectedPackages } from "../lib/types.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import {
  ALL_PACKAGES,
  PACKAGES_WITH_IMAGES,
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

    it("includes security scans with soft_fail", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      const trivy = steps.find((s) => s.key === "trivy-scan");
      expect(trivy).toBeDefined();
      expect(trivy?.soft_fail).toBe(true);
    });

    it("includes release track with wait gate", () => {
      const pipeline = buildPipeline(fullBuild());
      const waits = pipeline.steps.filter(isWait);
      expect(waits.length).toBeGreaterThan(0);

      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "release")).toBe(true);
    });

    it("includes image publish, npm, clauderon, cooklang, and sites groups", () => {
      const pipeline = buildPipeline(fullBuild());
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);

      expect(groupKeys).toContain("publish-images");
      expect(groupKeys).toContain("publish-npm");
      expect(groupKeys).toContain("clauderon-release");
      expect(groupKeys).toContain("cooklang-release");
      expect(groupKeys).toContain("deploy-sites");
    });

    it("includes homelab track", () => {
      const pipeline = buildPipeline(fullBuild());
      const groups = pipeline.steps.filter(isGroup);
      const groupKeys = groups.map((g) => g.key);

      expect(groupKeys).toContain("homelab-images");
      expect(groupKeys).toContain("homelab-helm");
      expect(groupKeys).toContain("homelab-tofu");
    });

    it("includes version commit-back", () => {
      const pipeline = buildPipeline(fullBuild());
      const steps = pipeline.steps.filter(isStep);
      expect(steps.some((s) => s.key === "version-commit-back")).toBe(true);
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

      expect(groupKeys).toContain("homelab-images");
      expect(groupKeys).toContain("homelab-helm");
      expect(groupKeys).toContain("homelab-tofu");
      expect(groupKeys).not.toContain("clauderon-release");
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

    it("all commands use dagger call (no shell script bypasses)", () => {
      const pipeline = buildPipeline(fullBuild());
      const nonDagger: string[] = [];

      function check(steps: unknown[]) {
        for (const s of steps) {
          if (typeof s !== "object" || s === null) continue;
          const obj = s as Record<string, unknown>;
          if (typeof obj["command"] === "string") {
            const cmd = obj["command"] as string;
            if (!cmd.includes("dagger call") && !cmd.includes("echo ")) {
              nonDagger.push(`${obj["key"]}: ${cmd}`);
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
