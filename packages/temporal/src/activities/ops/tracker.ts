import type { TrackerOverview } from "@shepherdjerred/ops-clients/tracker.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metric, truncate, type OpsCollection } from "./ops-types.ts";

/** Jerred's personal team; its triage queue is his to sort. */
export const OWNER_TEAM_KEY = "SJ";

export function mapTracker(overview: TrackerOverview): OpsCollection {
  const signals: SignalInput[] = overview.triage.map((issue) => ({
    id: `tracker:issue:${issue.identifier}`,
    source: "tracker",
    section: "work",
    kind: "triage-issue",
    severity: "info",
    needsMe: issue.team === OWNER_TEAM_KEY,
    title: truncate(`${issue.identifier} ${issue.title}`, 200),
    since: new Date(Date.parse(issue.createdAt)).toISOString(),
    attributes: { team: issue.team },
    links: [{ kind: "tracker", label: issue.identifier, url: issue.url }],
  }));
  const needsTriage = overview.triage.filter(
    (issue) => issue.team === OWNER_TEAM_KEY,
  ).length;
  return {
    signals,
    metrics: [
      metric({
        section: "work",
        source: "tracker",
        id: METRIC_IDS.trackerOpen,
        label: "Open issues",
        value: overview.open.length,
        unit: "count",
      }),
      metric({
        section: "work",
        source: "tracker",
        id: METRIC_IDS.trackerTriage,
        label: "In triage",
        value: overview.triage.length,
        unit: "count",
        severity: needsTriage > 0 ? "info" : "ok",
      }),
    ],
    changes: [],
  };
}
