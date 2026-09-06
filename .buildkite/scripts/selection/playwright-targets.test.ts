import { describe, expect, test } from "vitest";
import type { WorkspacePackage } from "../selectors/select-image-targets-workspaces.ts";
import {
  PLAYWRIGHT_TARGETS,
  selectPlaywrightTargets,
} from "./playwright-targets.ts";

const workspaces = new Map<string, WorkspacePackage>([
  ["sjer.red", { dir: "packages/sjer.red/", workspaceDependencies: [] }],
  [
    "@shepherdjerred/docs-wiki",
    { dir: "packages/docs/wiki/", workspaceDependencies: [] },
  ],
  [
    "@shepherdjerred/alert-dashboard",
    { dir: "packages/alert-dashboard/", workspaceDependencies: [] },
  ],
  [
    "@scout-for-lol/activity",
    {
      dir: "packages/scout-for-lol/packages/activity/",
      workspaceDependencies: [
        "@scout-for-lol/backend",
        "@scout-for-lol/design-system",
      ],
    },
  ],
  [
    "@scout-for-lol/backend",
    {
      dir: "packages/scout-for-lol/packages/backend/",
      workspaceDependencies: [],
    },
  ],
  [
    "@scout-for-lol/design-system",
    {
      dir: "packages/scout-for-lol/packages/design-system/",
      workspaceDependencies: ["@scout-for-lol/data"],
    },
  ],
  [
    "@scout-for-lol/evals",
    {
      dir: "packages/scout-for-lol/packages/evals/",
      workspaceDependencies: ["@scout-for-lol/data"],
    },
  ],
  [
    "@scout-for-lol/data",
    {
      dir: "packages/scout-for-lol/packages/data/",
      workspaceDependencies: [],
    },
  ],
]);

function packages(
  selection: Awaited<ReturnType<typeof selectPlaywrightTargets>>,
) {
  return selection.targets.map((target) => target.package);
}

describe("Playwright target selection", () => {
  test("selects only reverse-dependent browser targets", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/scout-for-lol/packages/backend/src/prompt.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["@scout-for-lol/activity"]);
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/scout-for-lol/packages/data/src/model.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual([
      "@scout-for-lol/activity",
      "@scout-for-lol/design-system",
      "@scout-for-lol/evals",
    ]);
  });

  test("selects every target for shared browser machinery", async () => {
    for (const changedPath of [
      ".buildkite/ci-playwright/Dockerfile",
      ".buildkite/scripts/selectors/select-image-targets-lockfile.ts",
      "scripts/ci-test-manifest.json",
      "scripts/lib/json.ts",
    ]) {
      const selection = await selectPlaywrightTargets(
        [changedPath],
        ".",
        workspaces,
      );
      expect(selection.mode).toBe("all");
      expect(packages(selection)).toEqual(
        PLAYWRIGHT_TARGETS.map((target) => target.package),
      );
    }
  });

  test("selects only static artifact producers for deploy harness changes", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["scripts/release/deploy-site.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["sjer.red", "@shepherdjerred/docs-wiki"]);
  });

  test("selects no browser suite for an unrelated package", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/leetcode/src/example.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual([]);
  });
});
