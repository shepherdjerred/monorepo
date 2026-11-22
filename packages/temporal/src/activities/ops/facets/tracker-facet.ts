import type {
  TrackerCompletedThroughput,
  TrackerForumPost,
  TrackerIssue,
  TrackerOverview,
  TrackerProjectCounts,
} from "@shepherdjerred/ops-clients/tracker.ts";
import type { TrackerFacet } from "@shepherdjerred/ops-model/facets.ts";
import { OWNER_TEAM_KEY } from "#activities/ops/tracker.ts";

function inferProjectTeams(
  open: readonly TrackerIssue[],
  completed: readonly TrackerIssue[],
): Map<string, string> {
  const byProject = new Map<string, Map<string, number>>();
  for (const issue of [...open, ...completed]) {
    if (issue.projectSlug === undefined) {
      continue;
    }
    let teamCounts = byProject.get(issue.projectSlug);
    if (teamCounts === undefined) {
      teamCounts = new Map<string, number>();
      byProject.set(issue.projectSlug, teamCounts);
    }
    teamCounts.set(issue.team, (teamCounts.get(issue.team) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const [slug, teamCounts] of byProject.entries()) {
    const top = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top !== undefined) {
      result.set(slug, top[0]);
    }
  }
  return result;
}

function issuePriorityRank(issue: TrackerIssue): number {
  if (issue.team === OWNER_TEAM_KEY && issue.stateType === "triage") {
    return 0;
  }
  if (issue.team === OWNER_TEAM_KEY && issue.stateType === "started") {
    return 1;
  }
  if (issue.stateType === "triage") {
    return 2;
  }
  return issue.stateType === "started" ? 3 : 4;
}

export function buildTrackerFacet(input: {
  overview: TrackerOverview;
  notices: readonly TrackerForumPost[];
  projects: readonly TrackerProjectCounts[];
  throughput: TrackerCompletedThroughput | null;
}): TrackerFacet {
  const openByTeam: Record<string, number> = {};
  for (const [team, stateCounts] of Object.entries(input.overview.counts)) {
    let sum = 0;
    for (const count of Object.values(stateCounts)) {
      sum += count;
    }
    openByTeam[team] = sum;
  }

  const projectTeams = inferProjectTeams(
    input.overview.open,
    input.throughput?.issues ?? [],
  );

  const projects: TrackerFacet["projects"] = input.projects
    .map((project) => ({
      slug: project.slug,
      name: project.name,
      team: projectTeams.get(project.slug) ?? "AI",
      openCount: project.open,
      completed7dCount: project.completed7d,
    }))
    .sort(
      (a, b) =>
        b.openCount - a.openCount ||
        b.completed7dCount - a.completed7dCount ||
        a.slug.localeCompare(b.slug),
    );

  const activeNotices: TrackerFacet["activeNotices"] = input.notices.map(
    (post) => ({
      identifier: post.identifier,
      kind: post.kind,
      title: post.title,
      owner: post.ownerKey,
      scopes: post.scopes,
      updatedAt: post.lastActivityAt,
      url: post.url,
    }),
  );

  const actionable = input.overview.open
    .filter(
      (issue) => issue.stateType === "triage" || issue.stateType === "started",
    )
    .sort(
      (a, b) =>
        issuePriorityRank(a) - issuePriorityRank(b) ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt),
    )
    .slice(0, 12);

  const urgentIssues: TrackerFacet["urgentIssues"] = actionable.map(
    (issue) => ({
      identifier: issue.identifier,
      title: issue.title,
      team: issue.team,
      urgency: issue.stateType === "triage" ? "high" : "medium",
      impact: issue.stateType,
      assignee: null,
      url: issue.url,
    }),
  );

  return {
    openByTeam,
    triageCount: input.overview.triage.length,
    completed7dCount: input.throughput?.total ?? 0,
    activeNotices,
    projects,
    urgentIssues,
  };
}
