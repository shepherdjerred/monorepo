import {
  EMPTY_PROJECT_AGGREGATES,
  SEVEN_DAYS_MS,
  toIssueListItem,
  toProjectSummary,
  type ProjectIssueAggregates,
  type ResolvedUrlConfig,
  type StoredIssueRow,
  type StoredProjectRow,
} from "#infrastructure/repository-helpers.ts";
import type {
  IssueListItem,
  IssueListQuery,
  OpsProjectSummary,
  OpsSummaryResponse,
  OpsTopIssue,
  OverviewResponse,
  Viewer,
} from "#shared/contract.ts";

type MutableProjectAggregates = {
  unresolvedCount: number;
  regressedCount: number;
  mutedCount: number;
  activeIssues7d: number;
  staleIssues: number;
  topOpen: StoredIssueRow | undefined;
};

function accumulateOpenIssue(
  acc: MutableProjectAggregates,
  issue: StoredIssueRow,
  cutoffMs: number,
): void {
  acc.unresolvedCount += 1;
  if (issue.regressedCount > 0) {
    acc.regressedCount += 1;
  }
  if (issue.lastSeen.getTime() >= cutoffMs) {
    acc.activeIssues7d += 1;
  } else {
    acc.staleIssues += 1;
  }
  if (
    acc.topOpen === undefined ||
    issue.lastSeen.getTime() > acc.topOpen.lastSeen.getTime()
  ) {
    acc.topOpen = issue;
  }
}

function computeSingleProjectAggregates(
  list: readonly StoredIssueRow[],
  cutoffMs: number,
): ProjectIssueAggregates {
  const acc: MutableProjectAggregates = {
    unresolvedCount: 0,
    regressedCount: 0,
    mutedCount: 0,
    activeIssues7d: 0,
    staleIssues: 0,
    topOpen: undefined,
  };
  for (const issue of list) {
    if (issue.state === "OPEN") {
      accumulateOpenIssue(acc, issue, cutoffMs);
    } else if (issue.state === "MUTED") {
      acc.mutedCount += 1;
    }
  }
  const topIssueTitle =
    acc.topOpen === undefined
      ? undefined
      : `${acc.topOpen.type}: ${acc.topOpen.value}`;
  return {
    unresolvedCount: acc.unresolvedCount,
    regressedCount: acc.regressedCount,
    mutedCount: acc.mutedCount,
    activeIssues7d: acc.activeIssues7d,
    staleIssues: acc.staleIssues,
    ...(topIssueTitle === undefined ? {} : { topIssueTitle }),
  };
}

export function computeAggregatesByProject(
  projects: readonly StoredProjectRow[],
  issues: readonly StoredIssueRow[],
  now: Date,
): Map<number, ProjectIssueAggregates> {
  const cutoffMs = now.getTime() - SEVEN_DAYS_MS;
  const grouped = new Map<number, StoredIssueRow[]>();
  for (const project of projects) {
    grouped.set(project.id, []);
  }
  for (const issue of issues) {
    const bucket = grouped.get(issue.projectId);
    if (bucket !== undefined) {
      bucket.push(issue);
    }
  }

  const out = new Map<number, ProjectIssueAggregates>();
  for (const project of projects) {
    const list = grouped.get(project.id) ?? [];
    out.set(project.id, computeSingleProjectAggregates(list, cutoffMs));
  }
  return out;
}

export function buildOverviewFromRows(input: {
  readonly viewer: Viewer;
  readonly projects: readonly StoredProjectRow[];
  readonly issues: readonly StoredIssueRow[];
  readonly events24h: number;
  readonly urls: ResolvedUrlConfig;
}): OverviewResponse {
  const now = input.urls.now();
  const aggregates = computeAggregatesByProject(
    input.projects,
    input.issues,
    now,
  );
  const projectMap = new Map(input.projects.map((p) => [p.id, p]));
  const projectSummaries = input.projects.map((project) =>
    toProjectSummary(
      project,
      aggregates.get(project.id) ?? EMPTY_PROJECT_AGGREGATES,
      input.urls,
    ),
  );

  const openIssues = input.issues
    .filter((issue) => issue.state === "OPEN")
    .sort((a, b) => {
      const aReg = a.regressedCount > 0 ? 1 : 0;
      const bReg = b.regressedCount > 0 ? 1 : 0;
      return aReg === bReg
        ? b.lastSeen.getTime() - a.lastSeen.getTime()
        : bReg - aReg;
    })
    .slice(0, 15);

  const attentionIssues: IssueListItem[] = [];
  for (const issue of openIssues) {
    const project = projectMap.get(issue.projectId);
    if (project !== undefined) {
      attentionIssues.push(toIssueListItem(issue, project));
    }
  }

  return {
    viewer: input.viewer,
    totalUnresolved: projectSummaries.reduce(
      (sum, p) => sum + p.unresolvedCount,
      0,
    ),
    totalRegressed: projectSummaries.reduce(
      (sum, p) => sum + p.regressedCount,
      0,
    ),
    activeIssues7d: projectSummaries.reduce(
      (sum, p) => sum + p.activeIssues7d,
      0,
    ),
    events24h: input.events24h,
    totalDigestedEvents: projectSummaries.reduce(
      (sum, p) => sum + p.digestedEventCount,
      0,
    ),
    totalStoredEvents: projectSummaries.reduce(
      (sum, p) => sum + p.storedEventCount,
      0,
    ),
    projects: projectSummaries,
    attentionIssues,
  };
}

export function buildOpsSummaryFromRows(input: {
  readonly projects: readonly StoredProjectRow[];
  readonly issues: readonly StoredIssueRow[];
  readonly urls: ResolvedUrlConfig;
}): OpsSummaryResponse {
  const now = input.urls.now();
  const aggregates = computeAggregatesByProject(
    input.projects,
    input.issues,
    now,
  );
  const projectMap = new Map(input.projects.map((p) => [p.id, p]));

  const opsProjects: OpsProjectSummary[] = input.projects.map((project) => {
    const agg = aggregates.get(project.id) ?? EMPTY_PROJECT_AGGREGATES;
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      url: `${input.urls.consolePublicOrigin}/projects/${project.slug}`,
      activeIssues7d: agg.activeIssues7d,
      staleIssues: agg.staleIssues,
      mutedIssues: agg.mutedCount,
      digestedEventsTotal: Number(project.digestedEventCount),
      ...(agg.topIssueTitle === undefined
        ? {}
        : { topIssueTitle: agg.topIssueTitle }),
    };
  });

  const topIssues: OpsTopIssue[] = input.issues
    .filter((issue) => issue.state === "OPEN" || issue.state === "MUTED")
    .sort((a, b) => {
      if (a.state !== b.state) {
        return a.state === "OPEN" ? -1 : 1;
      }
      return b.lastSeen.getTime() - a.lastSeen.getTime();
    })
    .slice(0, 25)
    .flatMap((issue) => {
      const project = projectMap.get(issue.projectId);
      if (project === undefined) {
        return [];
      }
      return [
        {
          id: issue.id,
          projectSlug: project.slug,
          type: issue.type,
          value: issue.value,
          transaction: issue.transaction,
          events: Number(issue.digestedEventCount),
          firstSeen: issue.firstSeen.toISOString(),
          lastSeen: issue.lastSeen.toISOString(),
          muted: issue.state === "MUTED",
          trackerIssueIdentifier: issue.trackerIssueIdentifier,
          url: `${input.urls.consolePublicOrigin}/issues/${issue.id}`,
        },
      ];
    });

  return {
    totalUnresolved: input.issues.filter((i) => i.state === "OPEN").length,
    totalDigestedEvents: input.projects.reduce(
      (sum, p) => sum + Number(p.digestedEventCount),
      0,
    ),
    projects: opsProjects,
    topIssues,
  };
}

function matchesTabFilter(
  issue: StoredIssueRow,
  tab: IssueListQuery["tab"],
): boolean {
  if (tab === undefined || tab === "all") {
    return true;
  }
  if (tab === "unresolved") {
    return issue.state === "OPEN";
  }
  if (tab === "regressed") {
    return issue.state === "OPEN" && issue.regressedCount > 0;
  }
  return tab === "muted"
    ? issue.state === "MUTED"
    : issue.state === "RESOLVED" || issue.state === "RESOLVED_NEXT_RELEASE";
}

export function matchesIssueFilter(
  issue: StoredIssueRow,
  query: IssueListQuery,
): boolean {
  if (query.state !== undefined && issue.state !== query.state) {
    return false;
  }
  if (!matchesTabFilter(issue, query.tab)) {
    return false;
  }
  if (
    query.release !== undefined &&
    query.release.length > 0 &&
    issue.lastRelease !== query.release
  ) {
    return false;
  }
  if (
    query.hasTrackerIssue === "true" &&
    issue.trackerIssueIdentifier === null
  ) {
    return false;
  }
  if (
    query.hasTrackerIssue === "false" &&
    issue.trackerIssueIdentifier !== null
  ) {
    return false;
  }
  if (query.q !== undefined && query.q.length > 0) {
    const needle = query.q.toLowerCase();
    return (
      issue.type.toLowerCase().includes(needle) ||
      issue.value.toLowerCase().includes(needle) ||
      issue.transaction.toLowerCase().includes(needle) ||
      (issue.trackerIssueIdentifier?.toLowerCase().includes(needle) ?? false)
    );
  }
  return true;
}

export function compareIssues(
  left: StoredIssueRow,
  right: StoredIssueRow,
  sort: IssueListQuery["sort"],
  order: IssueListQuery["order"],
): number {
  const dir = order === "asc" ? 1 : -1;
  let primary = 0;
  if (sort === "events") {
    if (left.digestedEventCount !== right.digestedEventCount) {
      primary = left.digestedEventCount > right.digestedEventCount ? 1 : -1;
    }
  } else if (sort === "first_seen") {
    primary = left.firstSeen.getTime() - right.firstSeen.getTime();
  } else {
    primary = left.lastSeen.getTime() - right.lastSeen.getTime();
  }
  return primary === 0 ? left.id.localeCompare(right.id) * dir : primary * dir;
}

export function paginateWithIdCursor<T extends { readonly id: string }>(
  sortedItems: readonly T[],
  cursor: string | undefined,
  limit: number,
): { readonly page: T[]; readonly nextCursor: string | null } {
  let startIndex = 0;
  if (cursor !== undefined && cursor.length > 0) {
    const idx = sortedItems.findIndex((item) => item.id === cursor);
    if (idx !== -1) {
      startIndex = idx + 1;
    }
  }
  const page = sortedItems.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < sortedItems.length;
  const lastItem = page.at(-1);
  return {
    page: [...page],
    nextCursor: hasMore && lastItem !== undefined ? lastItem.id : null,
  };
}
