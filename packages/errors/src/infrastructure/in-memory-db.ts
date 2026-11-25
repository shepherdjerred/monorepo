import {
  bulkUpdateInMemoryIssues,
  claimInMemoryOutbox,
  completeInMemoryOutbox,
  createInMemoryProject,
  createInMemoryRelease,
  failInMemoryOutbox,
  reconcileInMemoryImportedCounts,
  seedInMemoryCanonicalProjects,
  setInMemoryTrackerIssue,
  updateInMemoryIssueState,
  updateInMemoryProject,
  upsertInMemoryImportedIssue,
  upsertInMemoryImportedProject,
} from "#infrastructure/in-memory-mutations.ts";
import {
  findInMemoryProject,
  ingestInMemoryEvent,
  insertInMemoryImportedEvent,
  upsertInMemoryRelease,
  type InMemoryStore,
} from "#infrastructure/in-memory-store.ts";
import {
  buildOpsSummaryFromRows,
  buildOverviewFromRows,
  compareIssues,
  computeAggregatesByProject,
  matchesIssueFilter,
  paginateWithIdCursor,
} from "#infrastructure/repository-aggregates.ts";
import {
  EMPTY_PROJECT_AGGREGATES,
  isUuidString,
  resolveUrlConfig,
  toEventDetail,
  toEventListItem,
  toIssueListItem,
  toProjectSummary,
  TWENTY_FOUR_HOURS_MS,
} from "#infrastructure/repository-helpers.ts";
import type {
  ErrorsRepository,
  RepositoryUrlOptions,
} from "#infrastructure/repository-types.ts";
import { CANONICAL_PROJECTS } from "#infrastructure/seed-projects.ts";
import type { IssueListItem } from "#shared/contract.ts";

export type InMemoryRepositoryOptions = RepositoryUrlOptions & {
  readonly healthy?: (() => boolean) | undefined;
};

export function createInMemoryErrorsRepository(
  options?: InMemoryRepositoryOptions,
): ErrorsRepository {
  const urls = resolveUrlConfig(options);
  const isHealthy = options?.healthy ?? (() => true);
  const store: InMemoryStore = {
    urls,
    projects: new Map(),
    issues: new Map(),
    fingerprints: new Map(),
    events: new Map(),
    eventKeyIndex: new Map(),
    releases: new Map(),
    outbox: new Map(),
    nextProjectId: 100,
  };

  return {
    ping: () => Promise.resolve(isHealthy()),
    close: () => Promise.resolve(),

    seedCanonicalProjects: (seeds = CANONICAL_PROJECTS) =>
      Promise.resolve(seedInMemoryCanonicalProjects(store, seeds)),

    ingestEvent: (input) => Promise.resolve(ingestInMemoryEvent(store, input)),

    getOverview: (viewer) => {
      const now = urls.now();
      const cutoff = now.getTime() - TWENTY_FOUR_HOURS_MS;
      const projects = [...store.projects.values()].sort((a, b) => a.id - b.id);
      const issues = [...store.issues.values()];
      const events24h = [...store.events.values()].filter(
        (e) => e.timestamp.getTime() >= cutoff,
      ).length;
      return Promise.resolve(
        buildOverviewFromRows({ viewer, projects, issues, events24h, urls }),
      );
    },

    getOpsSummary: () =>
      Promise.resolve(
        buildOpsSummaryFromRows({
          projects: [...store.projects.values()].sort((a, b) => a.id - b.id),
          issues: [...store.issues.values()],
          urls,
        }),
      ),

    getMetricsSnapshot: () => {
      const projectRows = [...store.projects.values()].sort(
        (a, b) => a.id - b.id,
      );
      const pendingOutboxCount = [...store.outbox.values()].filter(
        (row) => row.sentAt === null,
      ).length;
      return Promise.resolve({
        projects: projectRows.map((p) => ({
          slug: p.slug,
          unresolvedCount: [...store.issues.values()].filter(
            (i) => i.projectId === p.id && i.state === "OPEN",
          ).length,
          digestedEventCount: Number(p.digestedEventCount),
        })),
        pendingOutboxCount,
      });
    },

    listProjects: () => {
      const projectRows = [...store.projects.values()].sort(
        (a, b) => a.id - b.id,
      );
      const aggregates = computeAggregatesByProject(
        projectRows,
        [...store.issues.values()],
        urls.now(),
      );
      return Promise.resolve(
        projectRows.map((p) =>
          toProjectSummary(
            p,
            aggregates.get(p.id) ?? EMPTY_PROJECT_AGGREGATES,
            urls,
          ),
        ),
      );
    },

    getProject: (idOrSlug) => {
      const project = findInMemoryProject(store, idOrSlug);
      if (project === null) {
        return Promise.resolve(null);
      }
      const projectIssues = [...store.issues.values()].filter(
        (i) => i.projectId === project.id,
      );
      const aggregates = computeAggregatesByProject(
        [project],
        projectIssues,
        urls.now(),
      );
      return Promise.resolve(
        toProjectSummary(
          project,
          aggregates.get(project.id) ?? EMPTY_PROJECT_AGGREGATES,
          urls,
        ),
      );
    },

    createProject: (input) =>
      Promise.resolve(createInMemoryProject(store, input)),

    updateProject: (idOrSlug, input) =>
      Promise.resolve(updateInMemoryProject(store, idOrSlug, input)),

    listIssues: (query) => {
      let projectIdFilter: number | undefined;
      if (query.project !== undefined && query.project.length > 0) {
        const project = findInMemoryProject(store, query.project);
        if (project === null) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        projectIdFilter = project.id;
      }
      const filtered = [...store.issues.values()]
        .filter(
          (issue) =>
            (projectIdFilter === undefined ||
              issue.projectId === projectIdFilter) &&
            matchesIssueFilter(issue, query),
        )
        .sort((a, b) => compareIssues(a, b, query.sort, query.order));

      const { page, nextCursor } = paginateWithIdCursor(
        filtered,
        query.cursor,
        query.limit,
      );
      const items: IssueListItem[] = [];
      for (const issue of page) {
        const project = store.projects.get(issue.projectId);
        if (project !== undefined) {
          items.push(toIssueListItem(issue, project));
        }
      }
      return Promise.resolve({ items, nextCursor });
    },

    getIssue: (id) => {
      const issue = store.issues.get(id);
      if (issue === undefined) {
        return Promise.resolve(null);
      }
      const project = store.projects.get(issue.projectId);
      if (project === undefined) {
        return Promise.resolve(null);
      }
      const fps = [...store.fingerprints.values()]
        .filter((f) => f.issueId === issue.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((f) => f.fingerprint);
      const latestEvent = [...store.events.values()]
        .filter((e) => e.issueId === issue.id)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

      return Promise.resolve({
        ...toIssueListItem(issue, project),
        fingerprints: fps,
        latestEvent:
          latestEvent === undefined ? null : toEventDetail(latestEvent),
      });
    },

    updateIssueState: (id, input) =>
      Promise.resolve(updateInMemoryIssueState(store, id, input)),

    bulkUpdateIssues: (input) =>
      Promise.resolve(bulkUpdateInMemoryIssues(store, input)),

    setTrackerIssue: (issueId, trackerIssueIdentifier) =>
      Promise.resolve(
        setInMemoryTrackerIssue(store, issueId, trackerIssueIdentifier),
      ),

    listEvents: (issueId, listOptions) => {
      if (!store.issues.has(issueId)) {
        return Promise.resolve(null);
      }
      const limit = Math.min(200, Math.max(1, listOptions?.limit ?? 50));
      const rows = [...store.events.values()]
        .filter((e) => e.issueId === issueId)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const { page, nextCursor } = paginateWithIdCursor(
        rows,
        listOptions?.cursor,
        limit,
      );
      return Promise.resolve({
        items: page.map((row) => toEventListItem(row)),
        nextCursor,
      });
    },

    getEvent: (idOrEventId) => {
      const direct = isUuidString(idOrEventId)
        ? store.events.get(idOrEventId)
        : undefined;
      if (direct !== undefined) {
        return Promise.resolve(toEventDetail(direct));
      }
      const byEventId = [...store.events.values()]
        .filter((e) => e.eventId === idOrEventId)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
      return Promise.resolve(
        byEventId === undefined ? null : toEventDetail(byEventId),
      );
    },

    listReleases: (projectFilter) => {
      let projectIdFilter: number | undefined;
      if (projectFilter !== undefined) {
        const project = findInMemoryProject(store, projectFilter);
        if (project === null) {
          return Promise.resolve({ items: [] });
        }
        projectIdFilter = project.id;
      }
      const rows = [...store.releases.values()]
        .filter(
          (r) =>
            projectIdFilter === undefined || r.projectId === projectIdFilter,
        )
        .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());
      return Promise.resolve({
        items: rows.flatMap((row) => {
          const project = store.projects.get(row.projectId);
          return project === undefined
            ? []
            : [
                {
                  id: row.id,
                  projectId: row.projectId,
                  projectSlug: project.slug,
                  version: row.version,
                  releasedAt: row.releasedAt.toISOString(),
                },
              ];
        }),
      });
    },

    createRelease: (input) =>
      Promise.resolve(createInMemoryRelease(store, input)),

    upsertImportedProject: (input) => {
      upsertInMemoryImportedProject(store, input);
      return Promise.resolve();
    },

    upsertImportedRelease: (input) => {
      upsertInMemoryRelease(store, input.projectId, input.version, {
        releasedAt: input.releasedAt,
        explicitId: input.id,
      });
      return Promise.resolve();
    },

    upsertImportedIssue: (input) => {
      upsertInMemoryImportedIssue(store, input);
      return Promise.resolve();
    },

    listExistingEventIdsForIssue: (issueId) => {
      const set = new Set<string>();
      for (const evt of store.events.values()) {
        if (evt.issueId === issueId) {
          set.add(evt.eventId);
        }
      }
      return Promise.resolve(set);
    },

    insertImportedEvent: (input) =>
      Promise.resolve(insertInMemoryImportedEvent(store, input)),

    reconcileImportedCounts: (projectIds) => {
      reconcileInMemoryImportedCounts(store, projectIds);
      return Promise.resolve();
    },

    claimPendingOutbox: (limit, now) =>
      Promise.resolve(claimInMemoryOutbox(store, limit, now ?? urls.now())),

    completeOutbox: (id, sentAt) => {
      completeInMemoryOutbox(store, id, sentAt);
      return Promise.resolve();
    },

    failOutbox: (id, errorMessage, nextAttemptAt) => {
      failInMemoryOutbox(store, id, errorMessage, nextAttemptAt);
      return Promise.resolve();
    },
  };
}
