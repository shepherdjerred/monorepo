import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";
import {
  executePrismaClaimPendingOutbox,
  executePrismaInsertImportedEvent,
  executePrismaReconcileImportedCounts,
} from "#infrastructure/prisma-import-outbox.ts";
import {
  bulkUpdatePrismaIssues,
  completePrismaOutbox,
  createPrismaProject,
  createPrismaRelease,
  failPrismaOutbox,
  findProjectRow,
  setPrismaTrackerIssue,
  updatePrismaIssueState,
  updatePrismaProject,
  upsertPrismaImportedIssue,
  upsertPrismaImportedProject,
  upsertPrismaImportedRelease,
} from "#infrastructure/prisma-mutations.ts";
import {
  executePrismaIngestEvent,
  syncProjectIdSequence,
} from "#infrastructure/prisma-queries.ts";
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

export function createDatabase(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function createPrismaErrorsRepository(
  prisma: PrismaClient,
  options?: RepositoryUrlOptions,
): ErrorsRepository {
  const urls = resolveUrlConfig(options);

  return {
    ping: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },

    close: async () => {
      await prisma.$disconnect();
    },

    seedCanonicalProjects: async (seeds = CANONICAL_PROJECTS) => {
      const created = await prisma.project.createMany({
        data: seeds.map((seed) => ({
          id: seed.id,
          slug: seed.slug,
          name: seed.name,
          publicKey: seed.publicKey,
        })),
        skipDuplicates: true,
      });
      await syncProjectIdSequence(prisma);
      return created.count;
    },

    ingestEvent: async (input) => executePrismaIngestEvent(prisma, input),

    getOverview: async (viewer) => {
      const now = urls.now();
      const since24h = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);
      const [projects, issues, events24h] = await Promise.all([
        prisma.project.findMany({ orderBy: { id: "asc" } }),
        prisma.issue.findMany(),
        prisma.event.count({ where: { timestamp: { gte: since24h } } }),
      ]);
      return buildOverviewFromRows({
        viewer,
        projects,
        issues,
        events24h,
        urls,
      });
    },

    getOpsSummary: async () => {
      const [projects, issues] = await Promise.all([
        prisma.project.findMany({ orderBy: { id: "asc" } }),
        prisma.issue.findMany(),
      ]);
      return buildOpsSummaryFromRows({ projects, issues, urls });
    },

    getMetricsSnapshot: async () => {
      const [projects, openCounts, pendingOutboxCount] = await Promise.all([
        prisma.project.findMany({
          orderBy: { id: "asc" },
          select: { id: true, slug: true, digestedEventCount: true },
        }),
        prisma.issue.groupBy({
          by: ["projectId"],
          where: { state: "OPEN" },
          _count: { _all: true },
        }),
        prisma.notificationOutbox.count({ where: { sentAt: null } }),
      ]);
      const openMap = new Map(
        openCounts.map((row) => [row.projectId, row._count._all]),
      );
      return {
        projects: projects.map((p) => ({
          slug: p.slug,
          unresolvedCount: openMap.get(p.id) ?? 0,
          digestedEventCount: Number(p.digestedEventCount),
        })),
        pendingOutboxCount,
      };
    },

    listProjects: async () => {
      const [projects, issues] = await Promise.all([
        prisma.project.findMany({ orderBy: { id: "asc" } }),
        prisma.issue.findMany(),
      ]);
      const aggregates = computeAggregatesByProject(
        projects,
        issues,
        urls.now(),
      );
      return projects.map((p) =>
        toProjectSummary(
          p,
          aggregates.get(p.id) ?? EMPTY_PROJECT_AGGREGATES,
          urls,
        ),
      );
    },

    getProject: async (idOrSlug) => {
      const project = await findProjectRow(prisma, idOrSlug);
      if (project === null) {
        return null;
      }
      const issues = await prisma.issue.findMany({
        where: { projectId: project.id },
      });
      const aggregates = computeAggregatesByProject(
        [project],
        issues,
        urls.now(),
      );
      return toProjectSummary(
        project,
        aggregates.get(project.id) ?? EMPTY_PROJECT_AGGREGATES,
        urls,
      );
    },

    createProject: async (input) => createPrismaProject(prisma, urls, input),

    updateProject: async (idOrSlug, input) =>
      updatePrismaProject(prisma, urls, idOrSlug, input),

    listIssues: async (query) => {
      let projectIdFilter: number | undefined;
      if (query.project !== undefined && query.project.length > 0) {
        const project = await findProjectRow(prisma, query.project);
        if (project === null) {
          return { items: [], nextCursor: null };
        }
        projectIdFilter = project.id;
      }
      const [projects, issues] = await Promise.all([
        prisma.project.findMany(),
        prisma.issue.findMany({
          ...(projectIdFilter === undefined
            ? {}
            : { where: { projectId: projectIdFilter } }),
        }),
      ]);
      const projectMap = new Map(projects.map((p) => [p.id, p]));
      const filtered = issues
        .filter((issue) => matchesIssueFilter(issue, query))
        .sort((a, b) => compareIssues(a, b, query.sort, query.order));

      const { page, nextCursor } = paginateWithIdCursor(
        filtered,
        query.cursor,
        query.limit,
      );
      const items: IssueListItem[] = [];
      for (const issue of page) {
        const project = projectMap.get(issue.projectId);
        if (project !== undefined) {
          items.push(toIssueListItem(issue, project));
        }
      }
      return { items, nextCursor };
    },

    getIssue: async (id) => {
      if (!isUuidString(id)) {
        return null;
      }
      const issue = await prisma.issue.findUnique({
        where: { id },
        include: {
          project: true,
          fingerprints: { orderBy: { createdAt: "asc" } },
        },
      });
      if (issue === null) {
        return null;
      }
      const latestEvent = await prisma.event.findFirst({
        where: { issueId: issue.id },
        orderBy: [{ timestamp: "desc" }, { ingestedAt: "desc" }],
      });
      return {
        ...toIssueListItem(issue, issue.project),
        fingerprints: issue.fingerprints.map((fp) => fp.fingerprint),
        latestEvent: latestEvent === null ? null : toEventDetail(latestEvent),
      };
    },

    updateIssueState: async (id, input) =>
      updatePrismaIssueState(prisma, id, input),

    bulkUpdateIssues: async (input) => bulkUpdatePrismaIssues(prisma, input),

    setTrackerIssue: async (issueId, trackerIssueIdentifier) =>
      setPrismaTrackerIssue(prisma, issueId, trackerIssueIdentifier),

    listEvents: async (issueId, listOptions) => {
      if (!isUuidString(issueId)) {
        return null;
      }
      const exists = await prisma.issue.findUnique({
        where: { id: issueId },
        select: { id: true },
      });
      if (exists === null) {
        return null;
      }
      const limit = Math.min(200, Math.max(1, listOptions?.limit ?? 50));
      const rows = await prisma.event.findMany({
        where: { issueId },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      });
      const { page, nextCursor } = paginateWithIdCursor(
        rows,
        listOptions?.cursor,
        limit,
      );
      return { items: page.map((row) => toEventListItem(row)), nextCursor };
    },

    getEvent: async (idOrEventId) => {
      const byUuid = isUuidString(idOrEventId)
        ? await prisma.event.findUnique({ where: { id: idOrEventId } })
        : null;
      if (byUuid !== null) {
        return toEventDetail(byUuid);
      }
      const byEventId = await prisma.event.findFirst({
        where: { eventId: idOrEventId },
        orderBy: { timestamp: "desc" },
      });
      return byEventId === null ? null : toEventDetail(byEventId);
    },

    listReleases: async (projectFilter) => {
      let projectIdFilter: number | undefined;
      if (projectFilter !== undefined) {
        const project = await findProjectRow(prisma, projectFilter);
        if (project === null) {
          return { items: [] };
        }
        projectIdFilter = project.id;
      }
      const rows = await prisma.release.findMany({
        ...(projectIdFilter === undefined
          ? {}
          : { where: { projectId: projectIdFilter } }),
        include: { project: { select: { slug: true } } },
        orderBy: [{ releasedAt: "desc" }, { version: "desc" }],
      });
      return {
        items: rows.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          projectSlug: row.project.slug,
          version: row.version,
          releasedAt: row.releasedAt.toISOString(),
        })),
      };
    },

    createRelease: async (input) => createPrismaRelease(prisma, urls, input),

    upsertImportedProject: async (input) =>
      upsertPrismaImportedProject(prisma, input),

    upsertImportedRelease: async (input) =>
      upsertPrismaImportedRelease(prisma, input),

    upsertImportedIssue: async (input) =>
      upsertPrismaImportedIssue(prisma, input),

    listExistingEventIdsForIssue: async (issueId) => {
      const rows = await prisma.event.findMany({
        where: { issueId },
        select: { eventId: true },
      });
      return new Set(rows.map((r) => r.eventId));
    },

    insertImportedEvent: async (input) =>
      executePrismaInsertImportedEvent(prisma, input),

    reconcileImportedCounts: async (projectIds) =>
      executePrismaReconcileImportedCounts(prisma, projectIds),

    claimPendingOutbox: async (limit, now) =>
      executePrismaClaimPendingOutbox(prisma, limit, now ?? urls.now()),

    completeOutbox: async (id, sentAt) =>
      completePrismaOutbox(prisma, urls, id, sentAt),

    failOutbox: async (id, errorMessage, nextAttemptAt) =>
      failPrismaOutbox(prisma, id, errorMessage, nextAttemptAt),
  };
}
