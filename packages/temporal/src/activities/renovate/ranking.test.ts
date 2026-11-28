import { describe, expect, test } from "vitest";
import type { RenovateVersionDelta } from "@shepherdjerred/ops-model/facets.ts";
import {
  compareRankedRenovateUpdates,
  isRenovateUpdateEligible,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";

import { readRenovateAdvisories } from "./ranking-advisories.ts";
import { extractReleaseEvidence, rankLookupTargets } from "./ranking-assess.ts";
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

  test("orders otherwise tied candidates by exact eligibility times with null first", () => {
    const [base] = rank(
      lookup([dependency("library", { updates: [update("library")] })]).targets,
    );
    if (base === undefined) throw new Error("expected ranked fixture");
    const candidate = (id: string, eligibleAt: string | null) => ({
      ...base,
      id,
      bake: { ...base.bake, eligibleAt },
    });
    expect(
      [
        candidate("later", "2026-11-26T12:00:00.500Z"),
        candidate("earlier", "2026-11-26T12:00:00Z"),
        candidate("no-date", null),
      ]
        .sort(compareRankedRenovateUpdates)
        .map((item) => item.id),
    ).toEqual(["no-date", "earlier", "later"]);
  });

  test("keeps one output pin while combining ready and pending observations", () => {
    const ready = update("library");
    const pending = update("library", { pendingChecks: true });
    for (const updates of [
      [ready, pending],
      [pending, ready],
      [ready, ready],
    ]) {
      const [candidate] = rank(
        lookup([dependency("library", { updates })]).targets,
      );
      expect(candidate?.targets).toHaveLength(1);
      expect(candidate?.bake.state).toBe(
        updates.includes(pending) ? "unknown" : "ready",
      );
    }
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
});

describe("Renovate group evidence", () => {
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

  test("the global Renovate selector holds a grouped proposal when a scoped member lookup fails", () => {
    const inventory = lookup(
      [
        dependency("@scope/member", { lookupFailed: true }),
        dependency("sibling", { updates: [update("all")] }),
      ],
      {
        config: {
          ...policy,
          packageRules: [{ groupName: "All", matchPackageNames: ["*"] }],
        },
      },
    );
    const [candidate] = rank(inventory.targets);
    expect(candidate?.blockers).toContain(
      "A related declaration has incomplete Renovate lookup evidence.",
    );
  });

  test("a failed Docker lookup does not hold the unrelated npm package of the same name", () => {
    const inventory = lookup([
      dependency("redis", { datasource: "docker", lookupFailed: true }),
      dependency("redis", { updates: [update("redis-npm")] }),
    ]);
    expect(inventory.incompleteLookups).toBe(1);
    expect(rank(inventory.targets)[0]?.blockers).toEqual([]);
  });

  test("reuses cached release deltas only when both versions match", () => {
    const inventory = lookup([
      dependency("library", { updates: [update("library")] }),
    ]);
    const delta: RenovateVersionDelta = {
      cacheKey: "example",
      generatedAt: now.toISOString(),
      runningVersion: null,
      pinnedVersion: "1.0.0",
      targetVersion: "2.0.0",
      effectiveFromVersion: "1.0.0",
      versionsBehindCount: 2,
      summary: "Cached comparison summary.",
      impactLevel: "breaking",
      breakingChanges: ["Example"],
      highlights: [],
      repoRelevance: "Example",
      evidenceSource: "github-releases",
      releaseUrls: [],
    };
    const withBaseline = (effectiveFromVersion: string) =>
      rankLookupTargets(inventory.targets, {
        advisories: new Map(),
        deltas: { "renovate/library": { ...delta, effectiveFromVersion } },
        releases: new Map(),
      })[0];
    expect(withBaseline("1.0.0")?.rationale).not.toContain(delta.summary);
    expect(withBaseline("v1.1.0")?.rationale).toContain(delta.summary);
  });

  test.each([
    [1, "m"],
    [8, "l"],
    [21, "xl"],
  ])(
    "incomplete upstream release coverage for %s paths is sized %s",
    (paths, effort) => {
      const member = dependency("library", {
        updates: [update("library", { updateType: "patch" })],
      });
      const inventory = lookup([member], {
        additionalFiles: Array.from({ length: paths - 1 }, (_, index) =>
          file(`packages/lib-${String(index)}/package.json`, [member]),
        ),
      });
      const [target] = inventory.targets;
      if (target === undefined) throw new Error("expected lookup fixture");
      const [candidate] = rankLookupTargets(inventory.targets, {
        advisories: new Map(),
        deltas: {},
        releases: new Map([
          [target, extractReleaseEvidence(target, [], false)],
        ]),
      });
      expect(candidate?.effort).toBe(effort);
      expect(candidate?.rationale).toContain(
        "Upstream release-note coverage is incomplete.",
      );
      expect(candidate?.rationale).not.toContain("Routine maintenance");
    },
  );

  test("surfaces invalid reports as errors instead of empty successful scans", () => {
    expect(() =>
      parseRenovateLookupInventory({ repositories: {} }, policy, now),
    ).toThrow("did not return an inventory");
  });
});

describe("Renovate advisory ranking", () => {
  test("raises urgency for a fixed advisory and holds a target that introduces one", async () => {
    const inventory = lookup([
      dependency("library", {
        currentValue: "1.1.0",
        lockedVersion: undefined,
        updates: [update("library")],
      }),
    ]);
    const fetchImpl: typeof fetch = Object.assign(
      async (url: string | Request | URL, init?: RequestInit) => {
        expect(url).toBe("https://api.osv.dev/v1/querybatch");
        expect(init?.body).toBe(
          JSON.stringify({
            queries: [
              {
                package: { ecosystem: "npm", name: "library" },
                version: "1.1.0",
              },
              {
                package: { ecosystem: "npm", name: "library" },
                version: "2.0.0",
              },
            ],
          }),
        );
        return Response.json({
          results: [
            { vulns: [{ id: "GHSA-fixed" }] },
            { vulns: [{ id: "GHSA-added" }] },
          ],
        });
      },
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

  test.each(["^1.1.0", "1.x", "npm:@scope/library@^1.1.0"])(
    "marks unresolved range %s as not assessed and skips the OSV query",
    async (currentValue) => {
      const inventory = lookup([
        dependency("library", {
          currentValue,
          lockedVersion: undefined,
          updates: [update("library")],
        }),
      ]);
      let requests = 0;
      const fetchImpl: typeof fetch = Object.assign(
        async () => {
          requests += 1;
          return Response.json({ results: [] });
        },
        { preconnect: fetch.preconnect },
      );
      const advisories = await readRenovateAdvisories(
        inventory.targets,
        fetchImpl,
      );
      expect(requests).toBe(0);
      expect([...advisories.values()][0]?.state).toBe("missing-version");
      const [candidate] = rankLookupTargets(inventory.targets, {
        advisories,
        deltas: {},
        releases: new Map(),
      });
      expect(candidate?.blockers).toContain(
        "Advisory assessment needs exact installed and target versions.",
      );
    },
  );

  test("keeps earlier advisory results and blocks targets from a failed batch", async () => {
    const inventory = lookup(
      Array.from({ length: 51 }, (_, index) =>
        dependency(`lib-${String(index)}`, {
          updates: [update(`lib-${String(index)}`)],
        }),
      ),
    );
    let requests = 0;
    const fetchImpl: typeof fetch = Object.assign(
      async () => {
        requests += 1;
        return requests === 1
          ? Response.json({
              results: Array.from({ length: 100 }, (_, index) =>
                index === 1 ? { vulns: [{ id: "GHSA-added" }] } : {},
              ),
            })
          : new Response(null, { status: 503 });
      },
      { preconnect: fetch.preconnect },
    );
    const advisories = await readRenovateAdvisories(
      inventory.targets,
      fetchImpl,
    );
    const candidates = rankLookupTargets(inventory.targets, {
      advisories,
      deltas: {},
      releases: new Map(),
    });
    const first = candidates.find(({ name }) => name === "lib-0");
    const independent = candidates.find(({ name }) => name === "lib-1");
    const failed = candidates.find(({ name }) => name === "lib-50");
    expect(requests).toBe(2);
    expect(first?.blockers).toContain(
      "The target introduces an advisory absent from the installed version (GHSA-added).",
    );
    expect(
      independent !== undefined &&
        isRenovateUpdateEligible(independent, now.getTime()),
    ).toBe(true);
    expect(failed?.blockers).toContain(
      "Advisory lookup did not complete for this target.",
    );
  });
});
