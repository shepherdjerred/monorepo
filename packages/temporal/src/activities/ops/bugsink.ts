import {
  bugsinkIssueUrl,
  bugsinkProjectUrl,
  type BugsinkIssue,
  type BugsinkProject,
} from "@shepherdjerred/ops-clients/bugsink.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { BUGSINK_URL, errorLogsLink } from "./ops-links.ts";
import {
  daysSince,
  hoursSince,
  metric,
  truncate,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

/** An issue first seen this recently is new and deserves a look. */
const NEW_ISSUE_HOURS = 24;
/** Unresolved issues not seen for this long are counted but not listed. */
const LISTED_WITHIN_DAYS = 7;

export type BugsinkProjectIssues = {
  project: BugsinkProject;
  issues: readonly BugsinkIssue[];
};

function issueSignal(
  project: BugsinkProject,
  issue: BugsinkIssue,
  context: OpsContext,
): SignalInput {
  const service = context.services.byBugsinkProject(project.slug);
  const isNew = hoursSince(issue.firstSeen, context.now) <= NEW_ISSUE_HOURS;
  const namespace = service?.namespaces[0];
  return {
    id: `bugsink:issue:${issue.id}`,
    source: "bugsink",
    section: "errors",
    ...(service === undefined ? {} : { service: service.id }),
    kind: "error-issue",
    severity: isNew ? "warning" : "info",
    needsMe: false,
    title: truncate(`${project.name}: ${issue.type}: ${issue.value}`, 200),
    ...(issue.transaction === ""
      ? {}
      : { detail: truncate(issue.transaction, 200) }),
    since: new Date(Date.parse(issue.firstSeen)).toISOString(),
    attributes: {
      project: project.slug,
      events: issue.events,
      lastSeen: issue.lastSeen,
      new: isNew,
    },
    links: [
      {
        kind: "bugsink",
        label: "Bugsink issue",
        url: bugsinkIssueUrl(BUGSINK_URL, issue.id),
      },
      {
        kind: "bugsink",
        label: `${project.name} issues`,
        url: bugsinkProjectUrl(BUGSINK_URL, project.id),
      },
      ...(namespace === undefined ? [] : [errorLogsLink(namespace)]),
    ],
  };
}

/** Unresolved, unmuted issue counts keyed by project slug. */
export function unresolvedByProject(
  projects: readonly BugsinkProjectIssues[],
): Map<string, number> {
  return new Map(
    projects.map(({ project, issues }) => [
      project.slug,
      issues.filter((issue) => !issue.muted).length,
    ]),
  );
}

export function mapBugsink(
  projects: readonly BugsinkProjectIssues[],
  context: OpsContext,
): OpsCollection {
  const signals: SignalInput[] = [];
  for (const { project, issues } of projects) {
    for (const issue of issues) {
      if (
        issue.muted ||
        daysSince(issue.lastSeen, context.now) > LISTED_WITHIN_DAYS
      ) {
        continue;
      }
      signals.push(issueSignal(project, issue, context));
    }
  }
  const total = [...unresolvedByProject(projects).values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  return {
    signals,
    metrics: [
      metric({
        section: "errors",
        source: "bugsink",
        id: METRIC_IDS.bugsinkUnresolved,
        label: "Unresolved errors",
        value: total,
        unit: "count",
      }),
    ],
    changes: [],
  };
}
