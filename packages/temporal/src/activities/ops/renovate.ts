import type {
  IssueBody,
  OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import {
  isRenovatePullRequest,
  parseDependencyDashboard,
} from "@shepherdjerred/ops-clients/renovate.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metric, truncate, type OpsCollection } from "./ops-types.ts";

export type RenovateGaugeState =
  "awaiting-approval" | "pending-checks" | "open-pr";

export type RenovateCollection = OpsCollection & {
  counts: Record<RenovateGaugeState, number>;
};

export function mapRenovate(
  dashboard: IssueBody,
  openPullRequests: readonly OpenPullRequest[],
): RenovateCollection {
  const parsed = parseDependencyDashboard(dashboard.body);
  const dashboardLink = {
    kind: "github" as const,
    label: "Dependency Dashboard",
    url: dashboard.url,
  };
  const signals: SignalInput[] = [];
  // One decision ("go tick the dashboard"), so one signal: a row per update
  // would count a hundred approvals as a hundred things waiting on me.
  const awaitingApproval = parsed.updates.filter(
    (update) => update.state === "awaiting-approval",
  );
  if (awaitingApproval.length > 0) {
    signals.push({
      id: "renovate:awaiting-approval",
      source: "renovate",
      section: "delivery",
      kind: "renovate-approval",
      severity: "info",
      needsMe: true,
      title: `${String(awaitingApproval.length)} Renovate update${awaitingApproval.length === 1 ? "" : "s"} awaiting approval`,
      detail: truncate(
        awaitingApproval.map((update) => update.title).join("; "),
        500,
      ),
      attributes: { count: awaitingApproval.length },
      links: [dashboardLink],
    });
  }
  const pending = parsed.counts["pending-checks"];
  if (pending > 0) {
    signals.push({
      id: "renovate:pending-checks",
      source: "renovate",
      section: "delivery",
      kind: "renovate-pending",
      severity: "info",
      needsMe: false,
      title: `${String(pending)} updates waiting on status checks`,
      attributes: { count: pending },
      links: [dashboardLink],
    });
  }
  const renovatePrs = openPullRequests.filter((pr) =>
    isRenovatePullRequest({ branch: pr.branch, authorLogin: pr.author?.login }),
  );
  // Only a PR that cannot merge by itself gets its own row; the healthy ones
  // are a single count.
  const healthyCreatedAt: number[] = [];
  for (const pr of renovatePrs) {
    const failing = pr.checks === "FAILURE" || pr.checks === "ERROR";
    if (!failing && pr.mergeable !== "CONFLICTING") {
      healthyCreatedAt.push(Date.parse(pr.createdAt));
      continue;
    }
    signals.push({
      id: `renovate:pr:${String(pr.number)}`,
      source: "renovate",
      section: "delivery",
      kind: "renovate-pr",
      severity: "warning",
      needsMe: false,
      title: truncate(`#${String(pr.number)} ${pr.title}`, 200),
      since: new Date(Date.parse(pr.createdAt)).toISOString(),
      attributes: { checks: pr.checks, mergeable: pr.mergeable },
      links: [
        { kind: "github", label: `PR #${String(pr.number)}`, url: pr.url },
      ],
    });
  }
  if (healthyCreatedAt.length > 0) {
    signals.push({
      id: "renovate:open-prs",
      source: "renovate",
      section: "delivery",
      kind: "renovate-open-prs",
      severity: "info",
      needsMe: false,
      title: `${String(healthyCreatedAt.length)} Renovate pull request${healthyCreatedAt.length === 1 ? "" : "s"} open`,
      since: new Date(Math.min(...healthyCreatedAt)).toISOString(),
      attributes: { count: healthyCreatedAt.length },
      links: [dashboardLink],
    });
  }
  const counts: Record<RenovateGaugeState, number> = {
    "awaiting-approval": parsed.counts["awaiting-approval"],
    "pending-checks": pending,
    "open-pr": renovatePrs.length,
  };
  return {
    signals,
    metrics: [
      metric({
        section: "delivery",
        source: "renovate",
        id: METRIC_IDS.renovatePending,
        label: "Pending updates",
        value:
          counts["awaiting-approval"] +
          counts["pending-checks"] +
          counts["open-pr"],
        unit: "count",
      }),
      metric({
        section: "delivery",
        source: "renovate",
        id: METRIC_IDS.renovateAwaitingApproval,
        label: "Awaiting approval",
        value: counts["awaiting-approval"],
        unit: "count",
        severity: counts["awaiting-approval"] > 0 ? "info" : "ok",
      }),
    ],
    changes: [],
    counts,
  };
}
