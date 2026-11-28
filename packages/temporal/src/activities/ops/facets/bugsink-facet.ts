import {
  bugsinkIssueUrl,
  bugsinkProjectUrl,
  type BugsinkClient,
} from "@shepherdjerred/ops-clients/bugsink.ts";
import type { BugsinkFacet } from "@shepherdjerred/ops-model/facets.ts";
import { bugsinkProjectDigestedEvents } from "#observability/metrics-ops.ts";
import type { BugsinkProjectIssues } from "#activities/ops/bugsink.ts";
import { BUGSINK_URL } from "#activities/ops/ops-links.ts";

const ACTIVE_WINDOW_MS = 7 * 86_400_000;
const TOP_ISSUES_GLOBAL_LIMIT = 20;

export async function fetchBugsinkIssuesBounded(
  bugsink: BugsinkClient,
): Promise<BugsinkProjectIssues[]> {
  const projects = await bugsink.projects();
  if (projects.length === 0) {
    return [];
  }
  const results = Array.from<BugsinkProjectIssues>({ length: projects.length });
  let nextIdx = 0;
  const concurrency = Math.min(4, projects.length);
  const runWorker = async (): Promise<void> => {
    while (nextIdx < projects.length) {
      const idx = nextIdx;
      nextIdx += 1;
      const project = projects[idx];
      if (project !== undefined) {
        results[idx] = {
          project,
          issues: await bugsink.unresolvedIssues(project.id),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

export function buildBugsinkFacet(input: {
  projectsWithIssues: readonly BugsinkProjectIssues[];
  now: Date;
  baseUrl?: string;
}): BugsinkFacet {
  const baseUrl = input.baseUrl ?? BUGSINK_URL;
  const nowMs = input.now.getTime();
  const projects: BugsinkFacet["projects"] = [];
  const candidateTopIssues: BugsinkFacet["topIssues"] = [];

  let totalUnresolved = 0;
  let totalDigestedEvents = 0;

  for (const { project, issues } of input.projectsWithIssues) {
    let activeIssues7d = 0;
    let staleIssues = 0;
    let mutedIssues = 0;
    let unresolvedEventsSum = 0;
    const unmuted = [];

    for (const issue of issues) {
      unresolvedEventsSum += issue.events;
      if (issue.muted) {
        mutedIssues += 1;
        continue;
      }
      unmuted.push(issue);
      if (nowMs - Date.parse(issue.lastSeen) <= ACTIVE_WINDOW_MS) {
        activeIssues7d += 1;
      } else {
        staleIssues += 1;
      }
      candidateTopIssues.push({
        id: issue.id,
        projectSlug: project.slug,
        type: issue.type,
        value: issue.value,
        transaction: issue.transaction,
        events: issue.events,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        muted: issue.muted,
        url: bugsinkIssueUrl(baseUrl, issue.id),
      });
    }

    unmuted.sort(
      (a, b) =>
        b.events - a.events || Date.parse(b.lastSeen) - Date.parse(a.lastSeen),
    );
    const top = unmuted[0];
    const digestedEventsTotal =
      project.digested_event_count ?? unresolvedEventsSum;

    totalUnresolved += activeIssues7d + staleIssues;
    totalDigestedEvents += digestedEventsTotal;

    projects.push({
      id: project.id,
      slug: project.slug,
      name: project.name,
      url: bugsinkProjectUrl(baseUrl, project.slug),
      activeIssues7d,
      staleIssues,
      mutedIssues,
      digestedEventsTotal,
      ...(top === undefined
        ? {}
        : { topIssueTitle: `${top.type}: ${top.value}` }),
    });
  }

  projects.sort(
    (a, b) =>
      b.activeIssues7d - a.activeIssues7d ||
      b.digestedEventsTotal - a.digestedEventsTotal ||
      a.slug.localeCompare(b.slug),
  );

  candidateTopIssues.sort(
    (a, b) =>
      b.events - a.events || Date.parse(b.lastSeen) - Date.parse(a.lastSeen),
  );

  return {
    totalUnresolved,
    totalDigestedEvents,
    projects,
    topIssues: candidateTopIssues.slice(0, TOP_ISSUES_GLOBAL_LIMIT),
  };
}

export function recordBugsinkFacetGauges(facet: BugsinkFacet): void {
  bugsinkProjectDigestedEvents.reset();
  for (const project of facet.projects) {
    bugsinkProjectDigestedEvents.set(
      { project: project.slug },
      project.digestedEventsTotal,
    );
  }
}
