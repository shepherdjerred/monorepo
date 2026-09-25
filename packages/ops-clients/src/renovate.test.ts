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

describe("parseDependencyDashboard", () => {
  test("counts approval and pending-check markers from a captured body", async () => {
    const dashboard = parseDependencyDashboard(await fixture());
    expect(dashboard.counts).toEqual({
      "awaiting-approval": 5,
      "pending-checks": 5,
    });
    expect(dashboard.updates[0]).toEqual({
      state: "awaiting-approval",
      branch: "renovate/dotnet-monorepo",
      title: "chore(deps): update dependency dotnet-sdk to v10.0.400",
    });
    // The "approve all" convenience checkbox is not an update.
    expect(
      dashboard.updates.some((update) => update.branch.includes("approve-all")),
    ).toBe(false);
  });

  test("a body without markers has no updates", () => {
    expect(parseDependencyDashboard("## Detected Dependencies\n")).toEqual({
      updates: [],
      counts: { "awaiting-approval": 0, "pending-checks": 0 },
    });
  });

  test("a checked box still counts and duplicates collapse", () => {
    const body = [
      " - [x] <!-- unpend-branch=renovate/a -->update a",
      " - [ ] <!-- unpend-branch=renovate/a -->update a",
    ].join("\n");
    expect(parseDependencyDashboard(body).counts["pending-checks"]).toBe(1);
  });
});

describe("isRenovatePullRequest", () => {
  test.each([
    [{ branch: "renovate/react", authorLogin: "someone" }, true],
    [{ branch: "feature", authorLogin: "renovate" }, true],
    [{ branch: "feature", authorLogin: "app/renovate" }, true],
    [{ branch: "feature", authorLogin: "derrej" }, false],
    [{ branch: "feature", authorLogin: undefined }, false],
  ])("%o -> %s", (input, expected) => {
    expect(isRenovatePullRequest(input)).toBe(expected);
  });
});
