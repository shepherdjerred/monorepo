import { describe, expect, test } from "vitest";

import { readRenovateAdvisories } from "./ranking-advisories.ts";
import { rankLookupTargets } from "./ranking-assess.ts";
import {
  parseRenovateLookupInventory,
  type LookupTarget,
} from "./ranking-report.ts";

const now = new Date("2026-11-26T12:00:00Z");
const policy = {
  minimumReleaseAge: "30 days",
  internalChecksFilter: "strict",
  packageRules: [
    { matchDatasources: ["git-refs"], minimumReleaseAge: "0 days" },
    { matchPackageNames: ["talos"], minimumReleaseAge: "0 days" },
  ],
};

function dependency(name: string, fields: Record<string, unknown> = {}) {
  return {
    depName: name,
    datasource: "npm",
    currentValue: "^1.1.0",
    currentVersion: "1.1.0",
    lockedVersion: "1.1.0",
    ...fields,
  };
}

function update(name: string, fields: Record<string, unknown> = {}) {
  return {
    branchName: `renovate/${name}`,
    updateType: "major",
    newValue: "^2.0.0",
    newVersion: "2.0.0",
    releaseTimestamp: "2026-10-26T11:30:00Z",
    ...fields,
  };
}

function file(packageFile: string, deps: readonly unknown[]) {
  return { packageFile, deps };
}

function lookup(
  deps: readonly unknown[],
  options: {
    config?: unknown;
    additionalFiles?: readonly unknown[];
  } = {},
) {
  return parseRenovateLookupInventory(
    {
      repositories: {
        local: {
          packageFiles: {
            bun: [
              file("package.json", deps),
              ...(options.additionalFiles ?? []),
            ],
          },
        },
      },
    },
    options.config ?? policy,
    now,
  );
}

function rank(targets: readonly LookupTarget[]) {
  return rankLookupTargets(targets, {
    advisories: new Map(),
    deltas: {},
    releases: new Map(),
  });
}

describe("Renovate lookup ranking", () => {
  test("preserves exact targets, group membership and candidate ID independently of lookup ordering", () => {
    const inventory = lookup(
      [dependency("react", { updates: [update("react-monorepo")] })],
      {
        additionalFiles: [
          file("packages/home/package.json", [
            dependency("react-dom", { updates: [update("react-monorepo")] }),
          ]),
        ],
      },
    );
    const candidates = rank(inventory.targets);

    expect(inventory.warnings).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "react, react-dom",
      effort: "m",
      bake: { state: "ready", eligibleAt: "2026-11-25T12:00:00.000Z" },
      targets: [
        {
          packageName: "react",
          filePath: "package.json",
          currentValue: "^1.1.0",
          targetValue: "^2.0.0",
        },
        {
          packageName: "react-dom",
          filePath: "packages/home/package.json",
          targetVersion: "2.0.0",
        },
      ],
    });
    expect(rank([...inventory.targets].reverse())).toEqual(candidates);
  });

  test("applies the release-age buffer, exact package and datasource overrides, and missing timestamps", () => {
    const inventory = lookup([
      dependency("young", {
        updates: [
          update("young", {
            releaseTimestamp: "2026-10-27T11:31:00Z",
            pendingChecks: true,
          }),
        ],
      }),
      dependency("talos", {
        updates: [update("talos", { releaseTimestamp: undefined })],
      }),
      dependency("custom-ref", {
        datasource: "git-refs",
        updates: [update("custom-ref", { releaseTimestamp: undefined })],
      }),
      dependency("undated", {
        updates: [
          update("undated", {
            releaseTimestamp: undefined,
            pendingChecks: true,
          }),
        ],
      }),
    ]);

    expect(
      inventory.targets.map(({ target, bake }) => [
        target.packageName,
        bake.state,
        bake.eligibleAt,
      ]),
    ).toEqual([
      ["young", "waiting", "2026-11-26T12:01:00.000Z"],
      ["talos", "ready", null],
      ["custom-ref", "ready", null],
      ["undated", "unknown", null],
    ]);
  });

  test("shows pending alternatives without claiming Renovate emitted an exact patch", () => {
    const inventory = lookup([
      dependency("example", {
        updates: [update("example", { pendingVersions: ["2.1.0", "2.2.0"] })],
      }),
    ]);
    expect(
      inventory.targets.map(({ target, bake, blocker }) => [
        target.targetVersion,
        bake.state,
        blocker !== null,
      ]),
    ).toEqual([
      ["2.0.0", "ready", false],
      ["2.1.0", "unknown", true],
      ["2.2.0", "unknown", true],
    ]);
  });

  test("holds related candidates without discarding unrelated valid lookup results", () => {
    const inventory = lookup(
      [
        dependency("react", { lookupFailed: true }),
        dependency("react-dom", { updates: [update("react-monorepo")] }),
        dependency("independent", { updates: [update("independent")] }),
      ],
      {
        config: {
          ...policy,
          packageRules: [
            ...policy.packageRules,
            { groupName: "React", matchPackageNames: ["react", "react-dom"] },
          ],
        },
      },
    );
    expect(inventory.incompleteLookups).toBe(1);
    expect(inventory.warnings).toHaveLength(1);
    expect(
      rank(inventory.targets).map(({ name, blockers }) => [
        name,
        blockers.length,
      ]),
    ).toEqual([
      ["independent", 0],
      ["react-dom", 1],
    ]);
  });

  test("surfaces invalid reports as errors instead of empty successful scans", () => {
    expect(() =>
      parseRenovateLookupInventory({ repositories: {} }, policy, now),
    ).toThrow("did not return an inventory");
  });

  test("raises urgency for a fixed advisory and holds a target that introduces one", async () => {
    const inventory = lookup([
      dependency("library", { updates: [update("library")] }),
    ]);
    const fetchImpl: typeof fetch = Object.assign(
      async () =>
        Response.json({
          results: [
            { vulns: [{ id: "GHSA-fixed" }] },
            { vulns: [{ id: "GHSA-added" }] },
          ],
        }),
      { preconnect: fetch.preconnect },
    );
    const advisories = await readRenovateAdvisories(
      inventory.targets,
      fetchImpl,
    );
    const [candidate] = rankLookupTargets(inventory.targets, {
      advisories,
      deltas: {},
      releases: new Map(),
    });
    expect(candidate).toMatchObject({
      urgency: "high",
      effort: "unknown",
      evidenceUrls: [
        "https://osv.dev/vulnerability/GHSA-fixed",
        "https://osv.dev/vulnerability/GHSA-added",
      ],
      blockers: [
        "The target introduces an advisory absent from the installed version (GHSA-added).",
      ],
    });
  });
});
