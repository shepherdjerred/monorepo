import { describe, expect, test } from "vitest";
import type { WoodpeckerPipeline } from "@shepherdjerred/ops-clients/woodpecker.ts";
import type { OpenPullRequest } from "@shepherdjerred/ops-clients/github.ts";
import { summarizeLinear } from "@shepherdjerred/ops-clients/linear.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { mapCi } from "./ci.ts";
import {
  authorClass,
  awaitsReview,
  mapGitHub,
  pullRequestSeverity,
  serviceFromTitle,
} from "./github.ts";
import { mapLinear } from "./linear.ts";
import { mapRenovate } from "./renovate.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const context = { now, services: new ServiceIndex() };

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function pr(overrides: Partial<OpenPullRequest>): OpenPullRequest {
  return {
    number: 1,
    title: "feat(birmel): add a thing",
    url: "https://github.com/shepherdjerred/monorepo/pull/1",
    author: { login: "derrej", kind: "user" },
    draft: false,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    branch: "feature",
    labels: [],
    checks: "SUCCESS",
    ...overrides,
  };
}

function build(
  number: number,
  status: WoodpeckerPipeline["status"],
): WoodpeckerPipeline {
  return {
    number,
    status,
    url: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
    commit: "0123456789abcdef0123456789abcdef01234567",
    message: "commit",
    createdAt: daysAgo(0.1),
    finishedAt: daysAgo(0.05),
  };
}

describe("ci", () => {
  test("a failed verdict on main is an error; a pass is ok", () => {
    const red = mapCi(
      { latest: build(11, "running"), verdict: build(10, "failure") },
      context,
    );
    expect(red.signals[0]).toMatchObject({
      severity: "error",
      service: "ci",
      attributes: { build: 10, latestBuild: 11, latestState: "running" },
    });
    const green = mapCi(
      { latest: build(10, "success"), verdict: build(10, "success") },
      context,
    );
    expect(green.signals[0]?.severity).toBe("ok");
  });

  test("no verdict at all is a failed source", () => {
    expect(() =>
      mapCi({ latest: undefined, verdict: undefined }, context),
    ).toThrow();
  });
});

describe("github", () => {
  test.each([
    [{ login: "shepherdjerred", kind: "user" as const }, "feature", "me"],
    [{ login: "derrej", kind: "user" as const }, "feature", "agent"],
    [{ login: "long-summer-intern", kind: "bot" as const }, "feature", "agent"],
    [{ login: "renovate", kind: "bot" as const }, "renovate/x", "renovate"],
    [{ login: "stranger", kind: "user" as const }, "feature", "other"],
    [undefined, "feature", "other"],
  ])("author %o on %s is %s", (author, branch, expected) => {
    expect(authorClass(author, branch)).toBe(expected);
  });

  test("only a green, mergeable, unreviewed agent PR awaits review", () => {
    expect(awaitsReview(pr({}))).toBe(true);
    expect(awaitsReview(pr({ draft: true }))).toBe(false);
    expect(awaitsReview(pr({ checks: "PENDING" }))).toBe(false);
    expect(awaitsReview(pr({ reviewDecision: "APPROVED" }))).toBe(false);
    expect(awaitsReview(pr({ mergeable: "CONFLICTING" }))).toBe(false);
    expect(
      awaitsReview(pr({ author: { login: "shepherdjerred", kind: "user" } })),
    ).toBe(false);
  });

  test("failing, conflicting, and stale PRs warn", () => {
    expect(pullRequestSeverity(pr({}), now)).toEqual({
      severity: "info",
      reasons: [],
    });
    expect(pullRequestSeverity(pr({ checks: "FAILURE" }), now).severity).toBe(
      "warning",
    );
    expect(pullRequestSeverity(pr({ updatedAt: daysAgo(8) }), now)).toEqual({
      severity: "warning",
      reasons: ["stale 8d"],
    });
    expect(
      pullRequestSeverity(pr({ draft: true, checks: "FAILURE" }), now).severity,
    ).toBe("info");
  });

  test("maps the conventional-commit scope to a service", () => {
    expect(serviceFromTitle("fix(scout): x", context)).toEqual({
      service: "scout-for-lol",
    });
    expect(serviceFromTitle("chore: bump", context)).toEqual({});
    expect(serviceFromTitle("feat(nope): x", context)).toEqual({});
  });

  test("builds signals, metrics, and change events", () => {
    const result = mapGitHub(
      {
        open: [
          pr({}),
          pr({
            number: 2,
            branch: "renovate/react",
            author: { login: "renovate", kind: "bot" },
          }),
        ],
        merged30d: [
          {
            number: 5,
            title: "feat(birmel): merged",
            url: "https://github.com/shepherdjerred/monorepo/pull/5",
            author: undefined,
            createdAt: daysAgo(1.5),
            mergedAt: daysAgo(1),
          },
          {
            number: 4,
            title: "old",
            url: "https://github.com/shepherdjerred/monorepo/pull/4",
            author: undefined,
            createdAt: daysAgo(21),
            mergedAt: daysAgo(20),
          },
        ],
        imagePins: [
          {
            oid: "abc",
            headline: "chore: bump pending image versions",
            committedAt: daysAgo(0.5),
            url: "https://github.com/shepherdjerred/monorepo/commit/abc",
          },
        ],
      },
      context,
    );
    expect(result.signals.map((s) => [s.id, s.needsMe, s.service])).toEqual([
      ["github:pr:1", true, "birmel"],
    ]);
    const metrics = Object.fromEntries(
      result.metrics.map((m) => [m.id, m.value]),
    );
    expect(metrics).toEqual({
      "github.prs.open": 1,
      "github.prs.awaiting_me": 1,
      "github.prs.merged_7d": 1,
      "github.prs.median_hours_to_merge_30d": 18,
    });
    expect(
      result.changes.map((c) => [c.kind, c.externalId, c.service]),
    ).toEqual([
      ["merge", "pr:5", "birmel"],
      ["image-bump", "commit:abc", undefined],
    ]);
  });
});

describe("renovate", () => {
  test("approvals need me; pending checks aggregate; PRs are listed", () => {
    const body = [
      " - [ ] <!-- approve-branch=renovate/a -->update a",
      " - [ ] <!-- approve-branch=renovate/b -->update b",
      " - [ ] <!-- unpend-branch=renovate/c -->update c",
    ].join("\n");
    const result = mapRenovate(
      {
        number: 481,
        url: "https://github.com/shepherdjerred/monorepo/issues/481",
        body,
      },
      [
        pr({
          number: 9,
          branch: "renovate/d",
          author: { login: "renovate", kind: "bot" },
          checks: "FAILURE",
        }),
        pr({}),
      ],
    );
    expect(result.signals.map((s) => [s.id, s.severity, s.needsMe])).toEqual([
      ["renovate:approve:renovate/a", "info", true],
      ["renovate:approve:renovate/b", "info", true],
      ["renovate:pending-checks", "info", false],
      ["renovate:pr:9", "warning", false],
    ]);
    expect(result.counts).toEqual({
      "awaiting-approval": 2,
      "pending-checks": 1,
      "open-pr": 1,
    });
    expect(result.metrics.map((m) => m.value)).toEqual([4, 2]);
  });
});

describe("linear", () => {
  test("SJ triage needs me; other triage is informational", () => {
    const issue = (
      identifier: string,
      team: string,
      stateType: "triage" | "started",
    ) => ({
      id: identifier,
      identifier,
      title: `Issue ${identifier}`,
      url: `https://linear.app/sjerred/issue/${identifier}`,
      createdAt: daysAgo(1),
      team,
      stateType,
    });
    const result = mapLinear(
      summarizeLinear(
        [
          issue("SJ-1", "SJ", "triage"),
          issue("AI-1", "AI", "triage"),
          issue("AI-2", "AI", "started"),
        ],
        [
          {
            team: "AI",
            teamName: "AI",
            number: 3,
            startsAt: daysAgo(3),
            endsAt: daysAgo(-11),
            progress: 0.25,
          },
        ],
      ),
    );
    expect(result.signals.map((s) => [s.id, s.needsMe])).toEqual([
      ["linear:issue:SJ-1", true],
      ["linear:issue:AI-1", false],
      ["linear:cycle:AI", false],
    ]);
    expect(result.signals[2]?.title).toBe("AI cycle 3: 25% done");
    expect(result.metrics.map((m) => [m.id, m.value])).toEqual([
      ["linear.issues.open", 3],
      ["linear.issues.triage", 2],
    ]);
  });
});
