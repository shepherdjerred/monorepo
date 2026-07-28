// Lane↔if_changed coverage: every path the main-branch selector
// (ci-changed.ts) treats as a lane input must be COVERED BY the corresponding
// PR step's `if_changed` globs, so a PR touching those inputs cannot merge
// without the PR-side gate having run. Subset, not equality — PR globs are
// deliberately broader (extension globs, the shared global closure).
//
// Division of labor: validate-pipeline.ts (run at pipeline upload) spot-checks
// specific critical inputs by string matching; this test owns the generic
// subset property over every lane, parsed from the real YAML.

import { describe, expect, test } from "bun:test";
import {
  globalPaths,
  lanePaths as selectorLanePaths,
  summaryLanes,
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

type SelectorLanes = {
  globalPaths: string[];
  lanePaths: Map<string, string[]>;
};

async function loadSelectorLanes(): Promise<SelectorLanes> {
  const lanePaths = new Map<string, string[]>();
  for (const [lane, paths] of Object.entries(selectorLanePaths)) {
    lanePaths.set(lane, [...paths]);
  }
  return { globalPaths: [...globalPaths], lanePaths };
}

// Which PR-side step gates each main lane's inputs. `images` is exempt here:
// both sides delegate to select-image-targets.ts, whose own test suite plus
// validate-pipeline.ts cover the images-pr glob list. `ci-image` is exempt
// because the refresh step is main-only and its PR-side inputs are already
// covered by `.buildkite/**` on every gated step.
const LANE_TO_STEP: Record<string, string | null> = {
  playwright: "playwright-e2e-pr",
  resume: "resume-build-pr",
  "docker-e2e": "docker-e2e-pr",
  images: null,
  "ci-image": null,
  "helm-types": "pr-dryrun",
  tofu: "pr-dryrun",
  helm: "pr-dryrun",
  argocd: "pr-dryrun",
  npm: "pr-dryrun",
  "site-sjer-red": "pr-dryrun",
  "site-resume": "pr-dryrun",
  "site-webring": "pr-dryrun",
  "site-cooklang": "pr-dryrun",
  "site-stocks": "pr-dryrun",
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

describe("lane↔if_changed coverage", () => {
  test("every ci-changed.ts lane maps to a PR step and vice versa", async () => {
    const { lanePaths } = await loadSelectorLanes();
    const lanes = new Set([...lanePaths.keys(), "images"]);
    expect([...lanes].sort()).toEqual(Object.keys(LANE_TO_STEP).sort());
  });

  test("every lane input is covered by its PR step's if_changed globs", async () => {
    const steps = await loadPipelineSteps();
    const { globalPaths: selectorGlobalPaths, lanePaths } =
      await loadSelectorLanes();
    const uncovered: string[] = [];
    for (const [lane, stepKey] of Object.entries(LANE_TO_STEP)) {
      if (stepKey === null) continue;
      const step = steps.get(stepKey);
      if (step === undefined || step.include.length === 0) {
        throw new Error(`step ${stepKey} is missing or has no if_changed`);
      }
      const entries = lanePaths.get(lane);
      if (entries === undefined) {
        throw new Error(`lane ${lane} not found in ci-changed.ts`);
      }
      for (const entry of [...selectorGlobalPaths, ...entries]) {
        for (const sample of await samplePaths(entry)) {
          if (!coveredBy(sample, step.include)) {
            uncovered.push(`${lane} → ${stepKey}: ${entry} (sample ${sample})`);
          }
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  test("build-summary's lane-decision table lists every lane", async () => {
    expect(Array.from(summaryLanes, String).sort()).toEqual(
      Object.keys(LANE_TO_STEP).sort(),
    );
  });
});
