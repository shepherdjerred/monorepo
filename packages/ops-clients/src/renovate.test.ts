import { describe, expect, test } from "vitest";
import {
  isRenovatePullRequest,
  parseDependencyDashboard,
} from "@shepherdjerred/ops-clients/renovate.ts";

async function fixture(): Promise<string> {
  return await Bun.file(
    new URL("fixtures/renovate-dependency-dashboard.md", import.meta.url),
  ).text();
}

describe("parseDependencyDashboard captured fixture", () => {
  test("counts markers, deprecations, and truncation from a captured body", async () => {
    const dashboard = parseDependencyDashboard(await fixture());
    expect(dashboard.counts).toEqual({
      "awaiting-approval": 5,
      "pending-checks": 5,
      "rate-limited": 0,
      "awaiting-schedule": 0,
      errored: 0,
      "edited-blocked": 0,
      ignored: 0,
    });
    expect(dashboard.updates[0]).toEqual({
      state: "awaiting-approval",
      branch: "renovate/dotnet-monorepo",
      title: "chore(deps): update dependency dotnet-sdk to v10.0.400",
      checked: false,
      packageName: "dotnet-sdk",
      targetVersion: "v10.0.400",
      ecosystem: "nuget",
      updateType: "patch",
    });
    expect(dashboard.updates[2]).toMatchObject({
      branch: "renovate/base64-0.x",
      packageName: "base64",
      targetVersion: "0.23.0",
      ecosystem: "rust",
      updateType: "minor",
    });
    expect(dashboard.updates[5]).toMatchObject({
      state: "pending-checks",
      branch: "renovate/caddy-2.11.4-alpine",
      packageName: "caddy:2.11.4-alpine",
      targetVersion: "6aeddd4",
      ecosystem: "docker",
      updateType: "digest",
    });
    expect(dashboard.updates[9]).toMatchObject({
      branch: "renovate/major-sentry-javascript-monorepo",
      packageName: "sentry-javascript monorepo",
      targetVersion: "v11",
      updateType: "major",
    });
    expect(dashboard.deprecations).toEqual([
      {
        datasource: "bun",
        packageName: "discord.js-selfbot-v13",
        packageUrl:
          "https://redirect.github.com/aiko-chan-ai/discord.js-selfbot-v13",
        replacement: undefined,
        replacementAvailable: false,
      },
      {
        datasource: "bun",
        packageName: "prom-client",
        packageUrl: "https://redirect.github.com/siimon/prom-client",
        replacement: undefined,
        replacementAvailable: false,
      },
    ]);
    expect(dashboard.lookupWarnings).toEqual([]);
    expect(dashboard.truncated).toBe(true);
    expect(
      dashboard.updates.some((update) => update.branch.includes("approve-all")),
    ).toBe(false);
  });

  test("a body without markers has zeroed counts and is not truncated", () => {
    expect(parseDependencyDashboard("## Detected Dependencies\n")).toEqual({
      updates: [],
      counts: {
        "awaiting-approval": 0,
        "pending-checks": 0,
        "rate-limited": 0,
        "awaiting-schedule": 0,
        errored: 0,
        "edited-blocked": 0,
        ignored: 0,
      },
      deprecations: [],
      lookupWarnings: [],
      truncated: false,
    });
  });
});

describe("parseDependencyDashboard extended sections", () => {
  test("parses all comment markers, Ignored/Blocked items, checked boxes, and warnings", () => {
    const body = [
      "> [!WARNING]",
      "> Renovate failed to look up the following dependencies: `Failed to look up npm package @private/pkg`.",
      ">",
      "> Files affected: `package.json`",
      "",
      "## Deprecations / Replacements",
      "| Datasource | Package | Replacement | Replacement PR? |",
      "| --- | --- | --- | --- |",
      "| npm | `rimraf` | `node:fs` | [#42](../pull/42) |",
      "",
      "## Rate-Limited",
      "- [x] <!-- unlimit-branch=renovate/helm-prom -->chore(deps): update helm release kube-prometheus-stack to v65.0.0",
      "## Awaiting Schedule",
      "- [ ] <!-- unschedule-branch=renovate/pin-actions -->chore(deps): pin actions/checkout action to v4",
      "## Errored",
      "- [ ] <!-- retry-branch=renovate/go-mod -->chore(deps): update module github.com/foo/bar from v1.2.0 to v1.3.0",
      "## Edited/Blocked",
      "- [x] <!-- rebase-branch=renovate/custom-edit -->[chore(deps): update terraform cloudflare to v5](../pull/99)",
      "## Open",
      "- [ ] <!-- rebase-branch=renovate/healthy-open -->[chore(deps): update react to v19.1.0](../pull/100)",
      "## Ignored or Blocked",
      "- [ ] <!-- recreate-branch=renovate/closed-pr -->[chore(deps): update lodash to v4.17.21](../pull/12)",
      "- [ ] chore(deps): update python to 3.14",
    ].join("\n");

    const parsed = parseDependencyDashboard(body);
    expect(parsed.counts).toEqual({
      "awaiting-approval": 0,
      "pending-checks": 0,
      "rate-limited": 1,
      "awaiting-schedule": 1,
      errored: 1,
      "edited-blocked": 1,
      ignored: 2,
    });
    expect(parsed.updates).toEqual([
      {
        state: "rate-limited",
        branch: "renovate/helm-prom",
        title:
          "chore(deps): update helm release kube-prometheus-stack to v65.0.0",
        checked: true,
        packageName: "kube-prometheus-stack",
        targetVersion: "v65.0.0",
        ecosystem: "helm",
        updateType: "major",
      },
      {
        state: "awaiting-schedule",
        branch: "renovate/pin-actions",
        title: "chore(deps): pin actions/checkout action to v4",
        checked: false,
        packageName: "actions/checkout",
        targetVersion: "v4",
        ecosystem: "github-actions",
        updateType: "pin",
      },
      {
        state: "errored",
        branch: "renovate/go-mod",
        title:
          "chore(deps): update module github.com/foo/bar from v1.2.0 to v1.3.0",
        checked: false,
        packageName: "github.com/foo/bar",
        targetVersion: "v1.3.0",
        ecosystem: "gomod",
        updateType: "minor",
      },
      {
        state: "edited-blocked",
        branch: "renovate/custom-edit",
        title: "chore(deps): update terraform cloudflare to v5",
        checked: true,
        packageName: "cloudflare",
        targetVersion: "v5",
        ecosystem: "terraform",
        updateType: "major",
      },
      {
        state: "ignored",
        branch: "renovate/closed-pr",
        title: "chore(deps): update lodash to v4.17.21",
        checked: false,
        packageName: "lodash",
        targetVersion: "v4.17.21",
        ecosystem: undefined,
        updateType: "patch",
      },
      {
        state: "ignored",
        branch: "renovate/ignored-chore-deps-update-python-to-3-14",
        title: "chore(deps): update python to 3.14",
        checked: false,
        packageName: "python",
        targetVersion: "3.14",
        ecosystem: "python",
        updateType: "minor",
      },
    ]);
    expect(parsed.deprecations).toEqual([
      {
        datasource: "npm",
        packageName: "rimraf",
        packageUrl: undefined,
        replacement: "node:fs",
        replacementAvailable: true,
      },
    ]);
    expect(parsed.lookupWarnings).toEqual([
      "Renovate failed to look up the following dependencies: `Failed to look up npm package @private/pkg`. Files affected: `package.json`",
    ]);
  });

  test("a checked box still counts, duplicates collapse, and >= 60k chars flags truncated", () => {
    const body = [
      " - [x] <!-- unpend-branch=renovate/a -->update a",
      " - [ ] <!-- unpend-branch=renovate/a -->update a",
    ].join("\n");
    const parsed = parseDependencyDashboard(body);
    expect(parsed.counts["pending-checks"]).toBe(1);
    expect(parsed.updates[0]?.checked).toBe(true);
    expect(parseDependencyDashboard("x".repeat(60_000)).truncated).toBe(true);
  });
});

describe("isRenovatePullRequest", () => {
  test.each([
    [{ branch: "renovate/react", authorLogin: "someone" }, true],
    [{ branch: "feature", authorLogin: "renovate" }, true],
    [{ branch: "feature", authorLogin: "app/renovate" }, true],
    [{ branch: "feature", authorLogin: "renovate[bot]" }, true],
    [{ branch: "feature", authorLogin: "derrej" }, false],
    [{ branch: "feature", authorLogin: undefined }, false],
  ])("%o -> %s", (input, expected) => {
    expect(isRenovatePullRequest(input)).toBe(expected);
  });
});
