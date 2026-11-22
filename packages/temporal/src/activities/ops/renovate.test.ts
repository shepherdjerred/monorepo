import { describe, expect, test } from "vitest";
import type {
  MergedPullRequest,
  OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import { RenovateFacetSchema } from "@shepherdjerred/ops-model/facets.ts";
import {
  buildRenovateFacet,
  parseRenovateDeltaIndex,
  readLatestRenovateDeltas,
} from "./facets/renovate-facet.ts";
import { mapRenovate } from "./renovate.ts";

const now = new Date("2026-11-21T22:00:00.000Z");

function openPr(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    number: 501,
    title: "chore(deps): update dependency zod to v5.0.0",
    url: "https://github.com/shepherdjerred/monorepo/pull/501",
    author: { login: "renovate[bot]", kind: "bot" },
    draft: false,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-21T10:00:00Z",
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    branch: "renovate/zod-5.x",
    baseRefName: "main",
    headOid: "abc123",
    exactHeadApproved: true,
    labels: ["Half upgrade"],
    checks: "SUCCESS",
    ...overrides,
  };
}

function mergedPr(
  overrides: Partial<MergedPullRequest> = {},
): MergedPullRequest {
  return {
    number: 499,
    title: "chore(deps): update dependency vitest to v5.0.3",
    url: "https://github.com/shepherdjerred/monorepo/pull/499",
    branch: "renovate/vitest-5.x",
    author: { login: "renovate[bot]", kind: "bot" },
    createdAt: "2026-11-19T00:00:00Z",
    mergedAt: "2026-11-19T02:30:00Z",
    ...overrides,
  };
}

describe("renovate mapper and enriched facet", () => {
  test("parses all 7 dashboard states, deprecations, warnings, PR metadata, and S3 deltas", () => {
    const body = [
      "> [!WARNING]",
      "> Failed to look up helm chart foo",
      "",
      "## Dependency Lookup Warnings",
      "",
      "## Deprecations / Replacements",
      "| Datasource | Package | Replacement | Replacement PR |",
      "| --- | --- | --- | --- |",
      "| npm | `@eslint/eslintrc` | `@eslint/compat` | #400 |",
      "",
      "## Awaiting Approval",
      " - [ ] <!-- approve-branch=renovate/zod-5.x -->chore(deps): update dependency zod to v5.0.0",
      " - [ ] <!-- unpend-branch=renovate/eslint-10.x -->chore(deps): update dependency eslint to v10.7.0",
      " - [ ] <!-- unlimit-branch=renovate/bun-1.4 -->chore(deps): update bun to v1.4.6",
      " - [ ] <!-- unschedule-branch=renovate/helm-chart -->chore(deps): update helm release traefik to v31",
      " - [ ] <!-- retry-branch=renovate/err-pkg -->chore(deps): update rust crate serde to v2",
      " - [ ] <!-- rebase-branch=renovate/blocked-pkg -->chore(deps): update npm package typescript to v7",
      "",
      "## Ignored or Blocked",
      " - [ ] <!-- unblock-branch=renovate/ignored-pkg -->chore(deps): update docker tag alpine to v3.22",
    ].join("\n");

    const indexJson = JSON.stringify({
      updatedAt: "2026-11-21T21:00:00Z",
      deltasByBranch: {
        "renovate/zod-5.x": {
          cacheKey: "npm:zod:4.4.3->5.0.0",
          generatedAt: "2026-11-21T21:00:00Z",
          runningVersion: "4.4.3",
          pinnedVersion: "4.4.3",
          targetVersion: "5.0.0",
          effectiveFromVersion: "4.4.3",
          versionsBehindCount: 1,
          summary: "Major Zod v5 release.",
          impactLevel: "breaking",
          breakingChanges: ["Removed deprecated string helpers"],
          highlights: ["Faster parsing"],
          repoRelevance: "Used in ops-model",
          evidenceSource: "github-releases",
          releaseUrls: [
            "https://github.com/colinhacks/zod/releases/tag/v5.0.0",
          ],
        },
      },
    });

    const deltasByBranch = parseRenovateDeltaIndex(indexJson);
    const facet = buildRenovateFacet({
      dashboard: {
        number: 481,
        url: "https://github.com/shepherdjerred/monorepo/issues/481",
        body,
      },
      openPullRequests: [
        openPr(),
        openPr({
          number: 502,
          branch: "renovate/standalone-open",
          title: "chore(deps): update dependency hono to v4.13.0",
          labels: [],
          exactHeadApproved: false,
        }),
      ],
      merged30d: [
        mergedPr(),
        mergedPr({
          number: 450,
          createdAt: "2026-11-01T00:00:00Z",
          mergedAt: "2026-11-01T06:30:00Z",
        }),
      ],
      deltasByBranch,
      now,
    });

    expect(() => RenovateFacetSchema.parse(facet)).not.toThrow();
    expect(facet.counts).toEqual({
      "awaiting-approval": 1,
      "pending-checks": 1,
      "rate-limited": 1,
      "awaiting-schedule": 1,
      errored: 1,
      "edited-blocked": 1,
      ignored: 1,
    });
    expect(facet.lookupWarnings).toEqual(["Failed to look up helm chart foo"]);
    expect(facet.deprecations[0]).toMatchObject({
      current: "@eslint/eslintrc",
      replacement: "@eslint/compat",
    });
    expect(facet.openPrCount).toBe(2);
    expect(facet.merged7dCount).toBe(1);
    expect(facet.merged30dCount).toBe(2);
    expect(facet.medianMergeHours).toBe(4.5);
    expect(facet.llmEnrichedCount).toBe(1);
    expect(facet.llmBreakingCount).toBe(1);

    const zodItem = facet.items.find((i) => i.branch === "renovate/zod-5.x");
    expect(zodItem).toMatchObject({
      prNumber: 501,
      exactHeadApproved: true,
      halfUpgrade: true,
      runningVersion: "4.4.3",
      pinnedVersion: "4.4.3",
      targetVersion: "5.0.0",
    });
    expect(zodItem?.delta?.impactLevel).toBe("breaking");

    const mapped = mapRenovate(
      {
        number: 481,
        url: "https://github.com/shepherdjerred/monorepo/issues/481",
        body,
      },
      [openPr()],
    );
    expect(mapped.counts).toEqual({
      "awaiting-approval": 1,
      "pending-checks": 1,
      "open-pr": 1,
    });
  });

  test("gracefully returns empty delta map when S3 is unconfigured", async () => {
    const prevEndpoint = Bun.env["S3_ENDPOINT"];
    Reflect.deleteProperty(Bun.env, "S3_ENDPOINT");
    await expect(readLatestRenovateDeltas()).resolves.toEqual({});
    if (prevEndpoint !== undefined) {
      Reflect.set(Bun.env, "S3_ENDPOINT", prevEndpoint);
    }
  });
});
