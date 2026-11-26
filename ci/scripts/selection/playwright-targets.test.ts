import { describe, expect, test } from "vitest";
import type { WorkspacePackage } from "../selectors/select-image-targets-workspaces.ts";
import { globalPaths } from "../migration-core.ts";
import {
  PLAYWRIGHT_TARGETS,
  additionalPlaywrightInstallFilters,
  playwrightTask,
  selectPlaywrightTargets,
} from "./playwright-targets.ts";
import { partitionPlaywrightSelection } from "./playwright-partition.ts";

const workspaces = new Map<string, WorkspacePackage>([
  [
    "@shepherdjerred/delivery",
    { dir: "packages/delivery/", workspaceDependencies: [] },
  ],
  [
    "@shepherdjerred/tracker",
    { dir: "packages/tracker/", workspaceDependencies: [] },
  ],
  [
    "@shepherdjerred/tasknotes-web",
    { dir: "packages/tasknotes-web/", workspaceDependencies: [] },
  ],
  [
    "tasknotes-server",
    { dir: "packages/tasknotes-server/", workspaceDependencies: [] },
  ],
  [
    "@shepherdjerred/artifacts",
    { dir: "packages/artifacts/", workspaceDependencies: [] },
  ],
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
    "@shepherdjerred/media",
    {
      dir: "packages/media/",
      workspaceDependencies: ["@shepherdjerred/config"],
    },
  ],
  [
    "@shepherdjerred/console-ui",
    { dir: "packages/console-ui/", workspaceDependencies: [] },
  ],
  [
    "@shepherdjerred/config",
    { dir: "packages/config/", workspaceDependencies: [] },
  ],
  [
    "@scout-for-lol/app",
    {
      dir: "packages/scout-for-lol/packages/app/",
      workspaceDependencies: [
        "@scout-for-lol/backend",
        "@scout-for-lol/data",
        "@scout-for-lol/design-system",
        "@scout-for-lol/report",
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
    "@scout-for-lol/report",
    {
      dir: "packages/scout-for-lol/packages/report/",
      workspaceDependencies: ["@scout-for-lol/data"],
    },
  ],
  [
    "@shepherdjerred/birmel",
    { dir: "packages/birmel/", workspaceDependencies: [] },
  ],
  [
    "@scout-for-lol/design-system",
    {
      dir: "packages/scout-for-lol/packages/design-system/",
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
  test.each([
    {
      changed: ["packages/delivery/src/client/app.tsx"],
      primary: ["@shepherdjerred/delivery"],
      media: [],
    },
    {
      changed: ["packages/media/src/client/library/page.tsx"],
      primary: [],
      media: ["@shepherdjerred/media"],
    },
    { changed: ["README.md"], primary: [], media: [] },
  ])(
    "filters a path selection with possible empty lanes for $changed",
    async ({ changed, primary, media }) => {
      const selected = await selectPlaywrightTargets(changed, ".", workspaces);
      const primarySelection = partitionPlaywrightSelection(
        selected,
        "primary",
      );
      const mediaSelection = partitionPlaywrightSelection(selected, "media");

      expect(packages(primarySelection)).toEqual(primary);
      expect(packages(mediaSelection)).toEqual(media);
      expect(primarySelection.mode).toBe("selected");
      expect(mediaSelection.mode).toBe("selected");
      expect({
        ...primarySelection.reasons,
        ...mediaSelection.reasons,
      }).toEqual(selected.reasons);
    },
  );

  test("selects Facet browser acceptance for its same-origin server changes", async () => {
    const packageName = "@shepherdjerred/tasknotes-web";
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/tasknotes-server/src/web-ui.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual([packageName]);
    expect(additionalPlaywrightInstallFilters([packageName])).toEqual([
      "tasknotes-server",
    ]);
  });

  test("selects Delivery browser acceptance for its service or UI changes", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/delivery/src/client/app.tsx"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["@shepherdjerred/delivery"]);
  });
  test("selects Media browser acceptance for its client, fixtures, or dependencies", async () => {
    for (const changed of [
      "packages/media/src/client/library/page.tsx",
      "packages/media/src/testing/fixture-api/library.ts",
      "packages/config/src/index.ts",
    ]) {
      expect(
        packages(await selectPlaywrightTargets([changed], ".", workspaces)),
      ).toEqual(["@shepherdjerred/media"]);
    }
  });
  test("selects only reverse-dependent browser targets", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/scout-for-lol/packages/backend/src/prompt.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["@scout-for-lol/app"]);
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/scout-for-lol/packages/data/src/model.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["@scout-for-lol/app", "@scout-for-lol/design-system"]);
  });

  test("selects the app catalog for its own components", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          [
            "packages/scout-for-lol/packages/app/src/components/chrome/section.tsx",
          ],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["@scout-for-lol/app"]);
    expect(additionalPlaywrightInstallFilters(["@scout-for-lol/app"])).toEqual([
      "@shepherdjerred/birmel",
    ]);
  });

  test("selects the app when its synthetic Prisma prerequisite changes", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["packages/birmel/src/index.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["@scout-for-lol/app"]);
    expect(additionalPlaywrightInstallFilters(["sjer.red"])).toEqual([]);
  });

  test("selects every target for shared browser machinery", async () => {
    for (const changedPath of [
      "ci/ci-playwright/Dockerfile",
      "ci/scripts/selection/playwright-partition.ts",
      "ci/scripts/selectors/select-image-targets-lockfile.ts",
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

  test("selects artifact producers for every global deployment input", async () => {
    for (const input of globalPaths) {
      for (const changedPath of [input, `${input}/nested.ts`]) {
        const selection = await selectPlaywrightTargets(
          [changedPath],
          ".",
          workspaces,
        );
        expect(selection.mode, changedPath).toBe("all");
        expect(packages(selection), changedPath).toEqual(
          PLAYWRIGHT_TARGETS.map((target) => target.package),
        );
      }
    }
  });

  test("does not match a sibling of a global input directory", async () => {
    const selection = await selectPlaywrightTargets(
      ["packages/woodpecker-config-extension/src-other/example.ts"],
      ".",
      workspaces,
    );
    expect(packages(selection)).toEqual([]);
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

  test("selects sjer.red for its build checker changes", async () => {
    expect(
      packages(
        await selectPlaywrightTargets(
          ["scripts/checks/check-built-internal-links.ts"],
          ".",
          workspaces,
        ),
      ),
    ).toEqual(["sjer.red"]);
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

describe("Vitest browser-mode targets", () => {
  test("selects console-ui's Vitest browser suite for its changes", async () => {
    const selection = await selectPlaywrightTargets(
      ["packages/console-ui/src/components/button.tsx"],
      ".",
      workspaces,
    );
    expect(packages(selection)).toEqual(["@shepherdjerred/console-ui"]);
    expect(selection.targets.map((target) => playwrightTask(target))).toEqual([
      "test:browser",
    ]);
  });

  test("runs every other browser target as a Playwright project", () => {
    const tasks = new Map(
      PLAYWRIGHT_TARGETS.map((target) => [
        target.package,
        playwrightTask(target),
      ]),
    );
    expect(tasks.get("@shepherdjerred/delivery")).toBe("test:e2e");
    expect(tasks.get("@shepherdjerred/console-ui")).toBe("test:browser");
  });
});
