import type { LinearOverview } from "@shepherdjerred/ops-clients/linear.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metric, truncate, type OpsCollection } from "./ops-types.ts";

/** Jerred's personal team; its triage queue is his to sort. */
export const OWNER_TEAM_KEY = "SJ";

export function mapLinear(overview: LinearOverview): OpsCollection {
  const signals: SignalInput[] = overview.triage.map((issue) => ({
    id: `linear:issue:${issue.identifier}`,
    source: "linear",
    section: "work",
    kind: "triage-issue",
    severity: "info",
    needsMe: issue.team === OWNER_TEAM_KEY,
    title: truncate(`${issue.identifier} ${issue.title}`, 200),
    since: new Date(Date.parse(issue.createdAt)).toISOString(),
    attributes: { team: issue.team },
    links: [{ kind: "linear", label: issue.identifier, url: issue.url }],
  }));
  for (const cycle of overview.cycles) {
    const open = Object.values(overview.counts[cycle.team] ?? {}).reduce(
      (total, count) => total + count,
      0,
    );
    signals.push({
      id: `linear:cycle:${cycle.team}`,
      source: "linear",
      section: "work",
      kind: "cycle",
      severity: "ok",
      needsMe: false,
      title: `${cycle.teamName} cycle ${String(cycle.number)}: ${String(Math.round(cycle.progress * 100))}% done`,
      since: new Date(Date.parse(cycle.startsAt)).toISOString(),
      attributes: {
        team: cycle.team,
        progress: cycle.progress,
        endsAt: cycle.endsAt,
        openIssues: open,
      },
    });
  }
  const needsTriage = overview.triage.filter(
    (issue) => issue.team === OWNER_TEAM_KEY,
  ).length;
  return {
    signals,
    metrics: [
      metric({
        section: "work",
        source: "linear",
        id: METRIC_IDS.linearOpen,
        label: "Open issues",
        value: overview.open.length,
        unit: "count",
      }),
      metric({
        section: "work",
        source: "linear",
        id: METRIC_IDS.linearTriage,
        label: "In triage",
        value: overview.triage.length,
        unit: "count",
        severity: needsTriage > 0 ? "info" : "ok",
      }),
    ],
    changes: [],
  };
}
