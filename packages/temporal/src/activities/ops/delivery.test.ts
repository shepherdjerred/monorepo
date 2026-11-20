import { describe, expect, test } from "vitest";
import type { WoodpeckerPipeline } from "@shepherdjerred/ops-clients/woodpecker.ts";
import type { OpenPullRequest } from "@shepherdjerred/ops-clients/github.ts";
import { summarizeTracker } from "@shepherdjerred/ops-clients/tracker.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { mapCi } from "./ci.ts";
import {
  authorClass,
  awaitsReview,
  mapGitHub,
  pullRequestSeverity,
  serviceFromTitle,
} from "./github.ts";
import { mapTracker } from "./tracker.ts";
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

function renovatePr(
  number: number,
  overrides: Partial<OpenPullRequest> = {},
): OpenPullRequest {
  return pr({
    number,
    branch: `renovate/pr-${String(number)}`,
    author: { login: "renovate", kind: "bot" },
    ...overrides,
  });
}

describe("renovate", () => {
  const dashboardUrl = "https://github.com/shepherdjerred/monorepo/issues/481";
  const dashboardLink = {
    kind: "github",
    label: "Dependency Dashboard",
    url: dashboardUrl,
  };

  function dashboard(lines: readonly string[]) {
    return { number: 481, url: dashboardUrl, body: lines.join("\n") };
  }

  test("approvals are one signal that needs me; pending checks aggregate; a failing PR is listed", () => {
    const result = mapRenovate(
      dashboard([
        " - [ ] <!-- approve-branch=renovate/a -->update a",
        " - [ ] <!-- approve-branch=renovate/b -->update b",
        " - [ ] <!-- unpend-branch=renovate/c -->update c",
      ]),
      [renovatePr(9, { checks: "FAILURE" }), pr({})],
    );
    expect(result.signals.map((s) => [s.id, s.severity, s.needsMe])).toEqual([
      ["renovate:awaiting-approval", "info", true],
      ["renovate:pending-checks", "info", false],
      ["renovate:pr:9", "warning", false],
    ]);
    expect(result.signals[0]).toEqual({
      id: "renovate:awaiting-approval",
      source: "renovate",
      section: "delivery",
      kind: "renovate-approval",
      severity: "info",
      needsMe: true,
      title: "2 Renovate updates awaiting approval",
      detail: "update a; update b",
      attributes: { count: 2 },
      links: [dashboardLink],
    });
    expect(result.counts).toEqual({
      "awaiting-approval": 2,
      "pending-checks": 1,
      "open-pr": 1,
    });
    expect(result.metrics.map((m) => m.value)).toEqual([4, 2]);
  });

  test("a hundred approvals are still one thing waiting on me", () => {
    const result = mapRenovate(
      dashboard(
        Array.from(
          { length: 100 },
          (_, index) =>
            ` - [ ] <!-- approve-branch=renovate/dep-${String(index)} -->chore(deps): update dependency-${String(index)} to v2`,
        ),
      ),
      [],
    );
    expect(result.signals.filter((s) => s.needsMe).map((s) => s.id)).toEqual([
      "renovate:awaiting-approval",
    ]);
    const [approval] = result.signals;
    expect(approval?.title).toBe("100 Renovate updates awaiting approval");
    expect(approval?.attributes).toEqual({ count: 100 });
    expect(approval?.detail).toHaveLength(500);
    expect(approval?.detail).toMatch(
      /^chore\(deps\): update dependency-0 to v2; chore\(deps\): update dependency-1 to v2; .*…$/u,
    );
    expect(result.counts["awaiting-approval"]).toBe(100);
    expect(result.metrics.map((m) => [m.value, m.severity])).toEqual([
      [100, "ok"],
      [100, "info"],
    ]);
  });

  test("a single approval is singular", () => {
    const result = mapRenovate(
      dashboard([" - [ ] <!-- approve-branch=renovate/a -->update a"]),
      [],
    );
    expect(result.signals.map((s) => [s.id, s.title, s.detail])).toEqual([
      [
        "renovate:awaiting-approval",
        "1 Renovate update awaiting approval",
        "update a",
      ],
    ]);
  });

  test("zero approvals emits no approval signal", () => {
    const pendingOnly = mapRenovate(
      dashboard([" - [ ] <!-- unpend-branch=renovate/c -->update c"]),
      [],
    );
    expect(pendingOnly.signals.map((s) => s.id)).toEqual([
      "renovate:pending-checks",
    ]);
    const empty = mapRenovate(dashboard([]), []);
    expect(empty.signals).toEqual([]);
    expect(empty.counts).toEqual({
      "awaiting-approval": 0,
      "pending-checks": 0,
      "open-pr": 0,
    });
    expect(empty.metrics.map((m) => [m.value, m.severity])).toEqual([
      [0, "ok"],
      [0, "ok"],
    ]);
  });

  test("a failing or conflicting PR stays individual while healthy PRs aggregate", () => {
    const result = mapRenovate(dashboard([]), [
      renovatePr(9, { checks: "FAILURE", createdAt: daysAgo(8) }),
      renovatePr(10, { createdAt: daysAgo(3) }),
      renovatePr(11, { createdAt: daysAgo(5) }),
      renovatePr(12, { mergeable: "CONFLICTING", createdAt: daysAgo(9) }),
      renovatePr(13, { checks: "PENDING", createdAt: daysAgo(2) }),
      renovatePr(14, { checks: "ERROR", createdAt: daysAgo(1) }),
      pr({ createdAt: daysAgo(30) }),
    ]);
    expect(result.signals.map((s) => [s.id, s.severity, s.needsMe])).toEqual([
      ["renovate:pr:9", "warning", false],
      ["renovate:pr:12", "warning", false],
      ["renovate:pr:14", "warning", false],
      ["renovate:open-prs", "info", false],
    ]);
    expect(result.signals[0]).toEqual({
      id: "renovate:pr:9",
      source: "renovate",
      section: "delivery",
      kind: "renovate-pr",
      severity: "warning",
      needsMe: false,
      title: "#9 feat(birmel): add a thing",
      since: daysAgo(8),
      attributes: { checks: "FAILURE", mergeable: "MERGEABLE" },
      links: [
        {
          kind: "github",
          label: "PR #9",
          url: "https://github.com/shepherdjerred/monorepo/pull/1",
        },
      ],
    });
    // Oldest healthy PR (#11, five days), not the older failing or foreign ones.
    expect(result.signals[3]).toEqual({
      id: "renovate:open-prs",
      source: "renovate",
      section: "delivery",
      kind: "renovate-open-prs",
      severity: "info",
      needsMe: false,
      title: "3 Renovate pull requests open",
      since: daysAgo(5),
      attributes: { count: 3 },
      links: [dashboardLink],
    });
    expect(result.counts["open-pr"]).toBe(6);
    expect(result.metrics.map((m) => m.value)).toEqual([6, 0]);
  });

  test("a single healthy PR is singular", () => {
    const result = mapRenovate(dashboard([]), [
      renovatePr(10, { createdAt: daysAgo(3) }),
    ]);
    expect(result.signals.map((s) => [s.id, s.title, s.since])).toEqual([
      ["renovate:open-prs", "1 Renovate pull request open", daysAgo(3)],
    ]);
  });
});

const trackerIssue = (
  identifier: string,
  team: string,
  stateType: "triage" | "started",
) => ({
  id: identifier,
  identifier,
  title: `Issue ${identifier}`,
  url: `https://tracker.tailnet-1a49.ts.net/issues/${identifier}`,
  createdAt: daysAgo(1),
  team,
  stateType,
});

describe("tracker", () => {
  test("SJ triage needs me; other triage is informational", () => {
    const result = mapTracker(
      summarizeTracker([
        trackerIssue("SJ-1", "SJ", "triage"),
        trackerIssue("AI-1", "AI", "triage"),
        trackerIssue("AI-2", "AI", "started"),
      ]),
    );
    expect(result.signals.map((s) => [s.id, s.needsMe])).toEqual([
      ["tracker:issue:SJ-1", true],
      ["tracker:issue:AI-1", false],
    ]);
    expect(result.metrics.map((m) => [m.id, m.value])).toEqual([
      ["tracker.issues.open", 3],
      ["tracker.issues.triage", 2],
    ]);
  });
});
