// Lane↔if_changed coverage: every path the main-branch selector
// (ci-changed.ts) treats as a lane input must be COVERED BY the corresponding
// PR step's `if_changed` globs, so a PR touching those inputs cannot merge
// without the PR-side gate having run. Subset, not equality — PR globs are
// deliberately broader (extension globs, the shared global closure).
//
// Division of labor: validate-pipeline.ts (run at pipeline upload) spot-checks
// specific critical inputs by string matching; this test owns the generic
// subset property over every lane, parsed from the real YAML.

import { describe, expect, test } from "vitest";
import { summaryLanes } from "./build-summary-tables.ts";
import {
  lanePaths as selectorLanePaths,
  selectorPathsForLane,
} from "./migration-core.ts";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

type PipelineStep = {
  key: string;
  include: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadPipelineSteps(): Promise<Map<string, PipelineStep>> {
  const parsed: unknown = Bun.YAML.parse(
    await Bun.file(`${REPO_ROOT}/.buildkite/pipeline.yml`).text(),
  );
  if (!isRecord(parsed) || !Array.isArray(parsed["steps"])) {
    throw new Error("pipeline.yml did not parse to a steps document");
  }
  const steps = new Map<string, PipelineStep>();
  for (const step of parsed["steps"]) {
    if (!isRecord(step) || typeof step["key"] !== "string") continue;
    const ifChanged = step["if_changed"];
    const include: string[] = [];
    if (isRecord(ifChanged) && Array.isArray(ifChanged["include"])) {
      for (const glob of ifChanged["include"]) {
        if (typeof glob !== "string") {
          throw new TypeError(
            `non-string if_changed glob in step ${step["key"]}`,
          );
        }
        include.push(glob);
      }
    }
    steps.set(step["key"], { key: step["key"], include });
  }
  return steps;
}

async function loadSelectorLanes(): Promise<Map<string, string[]>> {
  const lanePaths = new Map<string, string[]>();
  for (const [lane, paths] of Object.entries(selectorLanePaths)) {
    lanePaths.set(lane, [...paths]);
  }
  return lanePaths;
}

// Which PR-side step gates each main lane's inputs. `images` is exempt here:
// both sides delegate to select-image-targets.ts, whose own test suite plus
// validate-pipeline.ts cover the images-pr glob list. CI toolchain candidates
// are exempt because their generated digest PRs test the candidate images.
const LANE_TO_STEP: Record<string, string | readonly string[] | null> = {
  "hkctl-native": "hkctl-native-pr",
  "quotabar-macos": "quotabar-macos-pr",
  "tasknotes-native": "tasknotes-native-pr",
  playwright: "playwright-e2e-pr",
  resume: "resume-build-pr",
  trmnl: "trmnl-validate-pr",
  "docker-e2e": "docker-e2e-pr",
  images: null,
  "ci-base": null,
  "ci-playwright": null,
  "helm-types": "pr-dryrun",
  tofu: [
    "tofu-plan-seaweedfs",
    "tofu-plan-tailscale",
    "tofu-plan-buildkite",
    "tofu-plan-arr",
    "tofu-plan-github",
    "tofu-plan-cloudflare",
  ],
  "tofu-posthog": "tofu-posthog-plan",
  "tofu-platforms": "tofu-platforms-validate",
  helm: "pr-dryrun",
  argocd: "pr-dryrun",
  npm: "pr-dryrun",
  "site-sjer-red": "pr-dryrun",
  "site-resume": "pr-dryrun",
  "site-webring": "pr-dryrun",
  "site-cooklang": "pr-dryrun",
  "site-stocks": "pr-dryrun",
  "site-wiki": "pr-dryrun",
  "site-better-skill-capped": "pr-dryrun",
  "site-glitter": "pr-dryrun",
  "site-scout": "pr-dryrun",
  sites: "pr-dryrun",
  "scout-reconcile": "pr-dryrun",
  cooklang: "pr-dryrun",
};

/**
 * Sample concrete paths a lane entry stands for. An entry is a file iff it
 * exists as one in the live tree (Bun.file().exists() is false for
 * directories, so `packages/sjer.red` isn't mistaken for a file); everything
 * else samples a shallow and a nested child.
 */
async function samplePaths(entry: string): Promise<string[]> {
  const isFile = await Bun.file(`${REPO_ROOT}/${entry}`).exists();
  if (isFile) {
    return [entry];
  }
  return [`${entry}/sample-file.ts`, `${entry}/nested/dir/sample-file.ts`];
}

function coveredBy(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => new Bun.Glob(glob).match(path));
}

async function uncoveredLaneInputs(
  steps: ReadonlyMap<string, PipelineStep>,
  lane: string,
  mappedSteps: string | readonly string[],
): Promise<string[]> {
  const stepKeys =
    typeof mappedSteps === "string" ? [mappedSteps] : mappedSteps;
  const entries = selectorPathsForLane(lane);
  if (entries === undefined) {
    throw new Error(`lane ${lane} not found in ci-changed.ts`);
  }
  const sampledEntries = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      samples: await samplePaths(entry),
    })),
  );
  const uncovered: string[] = [];
  for (const stepKey of stepKeys) {
    const step = steps.get(stepKey);
    if (step === undefined || step.include.length === 0) {
      throw new Error(`step ${stepKey} is missing or has no if_changed`);
    }
    for (const { entry, samples } of sampledEntries) {
      for (const sample of samples) {
        if (coveredBy(sample, step.include)) continue;
        uncovered.push(`${lane} → ${stepKey}: ${entry} (sample ${sample})`);
      }
    }
  }
  return uncovered;
}

describe("lane↔if_changed coverage", () => {
  test("every ci-changed.ts lane maps to a PR step and vice versa", async () => {
    const lanePaths = await loadSelectorLanes();
    const lanes = new Set([...lanePaths.keys(), "images"]);
    expect([...lanes].sort()).toEqual(Object.keys(LANE_TO_STEP).sort());
  });

  test("every lane input is covered by its PR step's if_changed globs", async () => {
    const steps = await loadPipelineSteps();
    const uncovered: string[] = [];
    for (const [lane, mappedSteps] of Object.entries(LANE_TO_STEP)) {
      if (mappedSteps === null) continue;
      uncovered.push(...(await uncoveredLaneInputs(steps, lane, mappedSteps)));
    }
    expect(uncovered).toEqual([]);
  });

  test("native PR filters separate products, share infrastructure, and ignore unrelated changes", async () => {
    const steps = await loadPipelineSteps();
    const hkctlGlobs = steps.get("hkctl-native-pr")?.include ?? [];
    const quotaGlobs = steps.get("quotabar-macos-pr")?.include ?? [];
    const taskNotesGlobs = steps.get("tasknotes-native-pr")?.include ?? [];
    const cases = [
      ["packages/hkctl/Sources/HKCTLCore/Models.swift", true, false, false],
      [
        "packages/macos-ai-subscription-tracker/Sources/App.swift",
        false,
        true,
        false,
      ],
      ["packages/tasknotes-macos/Sources/App.swift", false, false, true],
      [".xcode-version", true, true, true],
      ["packages/anki/src/index.ts", false, false, false],
    ] as const;
    for (const [
      path,
      hkctlExpected,
      quotaExpected,
      taskNotesExpected,
    ] of cases) {
      expect(coveredBy(path, hkctlGlobs), path).toBe(hkctlExpected);
      expect(coveredBy(path, quotaGlobs), path).toBe(quotaExpected);
      expect(coveredBy(path, taskNotesGlobs), path).toBe(taskNotesExpected);
    }
  });

  test("build-summary's lane-decision table lists every lane", async () => {
    expect(Array.from(summaryLanes, String).sort()).toEqual(
      Object.keys(LANE_TO_STEP).sort(),
    );
  });

  // The subset property above is satisfied trivially by a lane that lists
  // nothing, so it cannot catch a release input going untracked. These lanes
  // package charts, reconcile Applications, regenerate Helm types, and promote
  // the Scout pin from the version catalog; dropping it here would let a
  // catalog-only commit skip them entirely.
  test("release lanes track the version catalog", () => {
    for (const lane of ["helm", "argocd", "helm-types", "scout-reconcile"]) {
      expect(selectorPathsForLane(lane)).toContain("packages/version-catalog");
    }
  });
});
