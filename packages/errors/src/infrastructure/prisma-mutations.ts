import type { PrismaClient } from "#generated/prisma/client.ts";
import { syncProjectIdSequence } from "#infrastructure/prisma-queries.ts";
import { computeAggregatesByProject } from "#infrastructure/repository-aggregates.ts";
import {
  EMPTY_PROJECT_AGGREGATES,
  generatePublicKey,
  isUuidString,
  parsePositiveIntId,
  resolveNextReleaseValue,
  slugifyProjectName,
  toIssueListItem,
  toProjectSummary,
  type ResolvedUrlConfig,
  type StoredProjectRow,
} from "#infrastructure/repository-helpers.ts";
import type {
  ImportedIssueInput,
  ImportedProjectInput,
  ImportedReleaseInput,
  UpdateIssueStateResult,
} from "#infrastructure/repository-types.ts";
import type {
  BulkUpdateIssuesInput,
  BulkUpdateIssuesResponse,
  CreateProjectInput,
  CreateReleaseInput,
  IssueListItem,
  ProjectSummary,
  ReleaseItem,
  UpdateIssueStateInput,
  UpdateProjectInput,
} from "#shared/contract.ts";

export async function findProjectRow(
  prisma: PrismaClient,
  idOrSlug: string | number,
): Promise<StoredProjectRow | null> {
  const numericId = parsePositiveIntId(idOrSlug);
  if (numericId !== null) {
    return prisma.project.findUnique({ where: { id: numericId } });
  }
  return typeof idOrSlug === "string"
    ? prisma.project.findUnique({ where: { slug: idOrSlug.trim() } })
    : null;
}

export async function createPrismaProject(
  prisma: PrismaClient,
  urls: ResolvedUrlConfig,
  input: CreateProjectInput,
): Promise<ProjectSummary> {
  await syncProjectIdSequence(prisma);
  const baseSlug = input.slug ?? slugifyProjectName(input.name);
  let candidateSlug = baseSlug;
  let suffix = 2;
  while (
    (await prisma.project.findUnique({ where: { slug: candidateSlug } })) !==
    null
  ) {
    candidateSlug = `${baseSlug.slice(0, 45)}-${String(suffix)}`;
    suffix += 1;
  }
  const created = await prisma.project.create({
    data: {
      slug: candidateSlug,
      name: input.name,
      publicKey: generatePublicKey(),
      alertOnNewIssue: input.alertOnNewIssue,
      alertOnRegression: input.alertOnRegression,
      retentionMaxEvents: input.retentionMaxEvents,
    },
  });
  return toProjectSummary(created, EMPTY_PROJECT_AGGREGATES, urls);
}

export async function updatePrismaProject(
  prisma: PrismaClient,
  urls: ResolvedUrlConfig,
  idOrSlug: string | number,
  input: UpdateProjectInput,
): Promise<ProjectSummary | null> {
  const existing = await findProjectRow(prisma, idOrSlug);
  if (existing === null) {
    return null;
  }
  const updated = await prisma.project.update({
    where: { id: existing.id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.alertOnNewIssue === undefined
        ? {}
        : { alertOnNewIssue: input.alertOnNewIssue }),
      ...(input.alertOnRegression === undefined
        ? {}
        : { alertOnRegression: input.alertOnRegression }),
      ...(input.retentionMaxEvents === undefined
        ? {}
        : { retentionMaxEvents: input.retentionMaxEvents }),
    },
  });
  const issues = await prisma.issue.findMany({
    where: { projectId: updated.id },
  });
  const aggregates = computeAggregatesByProject([updated], issues, urls.now());
  return toProjectSummary(
    updated,
    aggregates.get(updated.id) ?? EMPTY_PROJECT_AGGREGATES,
    urls,
  );
}

export async function updatePrismaIssueState(
  prisma: PrismaClient,
  id: string,
  input: UpdateIssueStateInput,
): Promise<UpdateIssueStateResult> {
  if (!isUuidString(id)) {
    return { status: "not_found" };
  }
  const current = await prisma.issue.findUnique({
    where: { id },
    include: { project: true },
  });
  if (current === null) {
    return { status: "not_found" };
  }
  if (
    input.expectedRevision !== undefined &&
    current.revision !== input.expectedRevision
  ) {
    return {
      status: "conflict",
      current: toIssueListItem(current, current.project),
    };
  }
  const updated = await prisma.issue.update({
    where: { id: current.id },
    data: {
      state: input.state,
      resolvedInRelease: resolveNextReleaseValue(
        input.state,
        input.resolvedInRelease,
        current.lastRelease,
      ),
      revision: { increment: 1 },
    },
    include: { project: true },
  });
  return { status: "ok", issue: toIssueListItem(updated, updated.project) };
}

export async function bulkUpdatePrismaIssues(
  prisma: PrismaClient,
  input: BulkUpdateIssuesInput,
): Promise<BulkUpdateIssuesResponse> {
  const validIds = input.ids.filter((id) => isUuidString(id));
  const existing = await prisma.issue.findMany({
    where: { id: { in: validIds } },
    include: { project: true },
  });
  const updatedItems: IssueListItem[] = [];
  for (const issue of existing) {
    const saved = await prisma.issue.update({
      where: { id: issue.id },
      data: {
        state: input.state,
        resolvedInRelease: resolveNextReleaseValue(
          input.state,
          input.resolvedInRelease,
          issue.lastRelease,
        ),
        revision: { increment: 1 },
      },
      include: { project: true },
    });
    updatedItems.push(toIssueListItem(saved, saved.project));
  }
  return { updatedCount: updatedItems.length, items: updatedItems };
}

export async function setPrismaTrackerIssue(
  prisma: PrismaClient,
  issueId: string,
  trackerIssueIdentifier: string,
): Promise<IssueListItem | null> {
  if (!isUuidString(issueId)) {
    return null;
  }
  const existing = await prisma.issue.findUnique({ where: { id: issueId } });
  if (existing === null) {
    return null;
  }
  const updated = await prisma.issue.update({
    where: { id: issueId },
    data: { trackerIssueIdentifier, revision: { increment: 1 } },
    include: { project: true },
  });
  return toIssueListItem(updated, updated.project);
}

export async function createPrismaRelease(
  prisma: PrismaClient,
  urls: ResolvedUrlConfig,
  input: CreateReleaseInput,
): Promise<ReleaseItem | null> {
  const project = await findProjectRow(prisma, input.project);
  if (project === null) {
    return null;
  }
  const releasedAt =
    input.releasedAt === undefined ? urls.now() : new Date(input.releasedAt);
  const saved = await prisma.release.upsert({
    where: {
      projectId_version: { projectId: project.id, version: input.version },
    },
    create: { projectId: project.id, version: input.version, releasedAt },
    update: { releasedAt },
  });
  return {
    id: saved.id,
    projectId: saved.projectId,
    projectSlug: project.slug,
    version: saved.version,
    releasedAt: saved.releasedAt.toISOString(),
  };
}

export async function upsertPrismaImportedProject(
  prisma: PrismaClient,
  input: ImportedProjectInput,
): Promise<void> {
  await prisma.project.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      slug: input.slug,
      name: input.name,
      publicKey: input.publicKey,
      digestedEventCount: BigInt(input.digestedEventCount),
      storedEventCount: input.storedEventCount,
      alertOnNewIssue: input.alertOnNewIssue,
      alertOnRegression: input.alertOnRegression,
    },
    update: {
      name: input.name,
      digestedEventCount: BigInt(input.digestedEventCount),
      alertOnNewIssue: input.alertOnNewIssue,
      alertOnRegression: input.alertOnRegression,
    },
  });
}

export async function upsertPrismaImportedRelease(
  prisma: PrismaClient,
  input: ImportedReleaseInput,
): Promise<void> {
  await prisma.release.upsert({
    where: {
      projectId_version: {
        projectId: input.projectId,
        version: input.version,
      },
    },
    create: {
      id: input.id,
      projectId: input.projectId,
      version: input.version,
      releasedAt: input.releasedAt,
    },
    update: { releasedAt: input.releasedAt },
  });
}

export async function upsertPrismaImportedIssue(
  prisma: PrismaClient,
  input: ImportedIssueInput,
): Promise<void> {
  const legacyFp = `legacy:bugsink:${input.id}`;
  await prisma.issue.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      projectId: input.projectId,
      primaryFingerprint: legacyFp,
      type: input.type,
      value: input.value,
      transaction: input.transaction,
      level: input.level,
      state: input.state,
      digestedEventCount: BigInt(input.digestedEventCount),
      storedEventCount: input.storedEventCount,
      firstSeen: input.firstSeen,
      lastSeen: input.lastSeen,
    },
    update: {
      type: input.type,
      value: input.value,
      transaction: input.transaction,
      level: input.level,
      state: input.state,
      digestedEventCount: BigInt(input.digestedEventCount),
      firstSeen: input.firstSeen,
      lastSeen: input.lastSeen,
    },
  });
  await prisma.issueFingerprint.upsert({
    where: {
      projectId_fingerprint: {
        projectId: input.projectId,
        fingerprint: legacyFp,
      },
    },
    create: {
      projectId: input.projectId,
      fingerprint: legacyFp,
      issueId: input.id,
    },
    update: { issueId: input.id },
  });
}

export async function completePrismaOutbox(
  prisma: PrismaClient,
  urls: ResolvedUrlConfig,
  id: string,
  sentAt?: Date,
): Promise<void> {
  await prisma.notificationOutbox.update({
    where: { id },
    data: {
      sentAt: sentAt ?? urls.now(),
      lastError: null,
      attempts: { increment: 1 },
    },
  });
}

export async function failPrismaOutbox(
  prisma: PrismaClient,
  id: string,
  errorMessage: string,
  nextAttemptAt: Date,
): Promise<void> {
  await prisma.notificationOutbox.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      lastError: errorMessage,
      nextAttemptAt,
    },
  });
}
