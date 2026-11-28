import type { PrismaClient } from "#generated/prisma/client.ts";
import {
  syncProjectIdSequence,
  toPrismaJsonObject,
} from "#infrastructure/prisma-queries.ts";
import { shouldPreferCandidateIssueForFingerprint } from "#infrastructure/repository-helpers.ts";
import type {
  ClaimedOutboxNotification,
  ImportedEventInput,
} from "#infrastructure/repository-types.ts";

const OUTBOX_CLAIM_LEASE_MS = 60_000;

export async function executePrismaInsertImportedEvent(
  prisma: PrismaClient,
  input: ImportedEventInput,
): Promise<{
  readonly inserted: boolean;
  readonly fingerprintRegistered: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({
      where: {
        projectId_eventId: {
          projectId: input.projectId,
          eventId: input.eventId,
        },
      },
      select: { id: true },
    });
    const inserted = existing === null;
    if (inserted) {
      await tx.event.upsert({
        where: { id: input.id },
        create: {
          id: input.id,
          eventId: input.eventId,
          issueId: input.issueId,
          projectId: input.projectId,
          timestamp: input.timestamp,
          ingestedAt: input.ingestedAt,
          release: input.release,
          environment: input.environment,
          platform: input.platform,
          level: input.level,
          transaction: input.transaction,
          data: toPrismaJsonObject(input.data),
          stacktraceMd: input.stacktraceMd,
        },
        update: {},
      });
    }

    const targetIssue = await tx.issue.findUnique({
      where: { id: input.issueId },
      select: { id: true, state: true, lastSeen: true },
    });
    if (targetIssue === null) {
      return { inserted, fingerprintRegistered: false };
    }

    const existingFp = await tx.issueFingerprint.findUnique({
      where: {
        projectId_fingerprint: {
          projectId: input.projectId,
          fingerprint: input.computedFingerprint,
        },
      },
      include: { issue: { select: { id: true, state: true, lastSeen: true } } },
    });

    let fingerprintRegistered = false;
    if (existingFp === null) {
      await tx.issueFingerprint.upsert({
        where: {
          projectId_fingerprint: {
            projectId: input.projectId,
            fingerprint: input.computedFingerprint,
          },
        },
        create: {
          projectId: input.projectId,
          fingerprint: input.computedFingerprint,
          issueId: targetIssue.id,
        },
        update: {},
      });
      fingerprintRegistered = true;
    } else if (
      existingFp.issueId !== targetIssue.id &&
      shouldPreferCandidateIssueForFingerprint(targetIssue, existingFp.issue)
    ) {
      await tx.issueFingerprint.update({
        where: {
          projectId_fingerprint: {
            projectId: input.projectId,
            fingerprint: input.computedFingerprint,
          },
        },
        data: { issueId: targetIssue.id },
      });
      fingerprintRegistered = true;
    }

    return { inserted, fingerprintRegistered };
  });
}

export async function executePrismaReconcileImportedCounts(
  prisma: PrismaClient,
  projectIds?: readonly number[],
): Promise<void> {
  await syncProjectIdSequence(prisma);
  const projects = await prisma.project.findMany({
    ...(projectIds === undefined || projectIds.length === 0
      ? {}
      : { where: { id: { in: [...projectIds] } } }),
    select: { id: true, digestedEventCount: true },
  });

  for (const project of projects) {
    const issues = await prisma.issue.findMany({
      where: { projectId: project.id },
      select: { id: true, digestedEventCount: true, lastRelease: true },
    });
    let projectStored = 0;
    let projectDigestedSum = 0n;

    for (const issue of issues) {
      const eventCount = await prisma.event.count({
        where: { issueId: issue.id },
      });
      const latestWithRelease = await prisma.event.findFirst({
        where: { issueId: issue.id, release: { not: null } },
        orderBy: { timestamp: "desc" },
        select: { release: true },
      });
      projectStored += eventCount;
      projectDigestedSum += issue.digestedEventCount;

      await prisma.issue.update({
        where: { id: issue.id },
        data: {
          storedEventCount: eventCount,
          lastRelease: latestWithRelease?.release ?? issue.lastRelease,
        },
      });
    }

    const nextDigested =
      project.digestedEventCount > projectDigestedSum
        ? project.digestedEventCount
        : projectDigestedSum;
    await prisma.project.update({
      where: { id: project.id },
      data: {
        storedEventCount: projectStored,
        digestedEventCount: nextDigested,
      },
    });
  }
}

export async function executePrismaClaimPendingOutbox(
  prisma: PrismaClient,
  limit: number,
  now: Date,
): Promise<ClaimedOutboxNotification[]> {
  if (limit <= 0) {
    return [];
  }
  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<readonly { id: string }[]>`
      SELECT id
      FROM notification_outbox
      WHERE sent_at IS NULL AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    if (lockedRows.length === 0) {
      return [];
    }
    const ids = lockedRows.map((row) => row.id);
    const leaseUntil = new Date(now.getTime() + OUTBOX_CLAIM_LEASE_MS);
    await tx.notificationOutbox.updateMany({
      where: { id: { in: ids } },
      data: { nextAttemptAt: leaseUntil },
    });

    const rows = await tx.notificationOutbox.findMany({
      where: { id: { in: ids } },
      include: {
        issue: {
          include: { project: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const claimed: ClaimedOutboxNotification[] = [];
    for (const row of rows) {
      const matchingEvent = await tx.event.findFirst({
        where: {
          projectId: row.issue.projectId,
          eventId: row.eventId,
        },
        select: { stacktraceMd: true, release: true, environment: true },
      });
      claimed.push({
        id: row.id,
        issueId: row.issueId,
        eventId: row.eventId,
        kind: row.kind,
        messageId: row.messageId,
        attempts: row.attempts,
        projectSlug: row.issue.project.slug,
        projectName: row.issue.project.name,
        issueType: row.issue.type,
        issueValue: row.issue.value,
        transaction: row.issue.transaction,
        release: matchingEvent?.release ?? row.issue.lastRelease,
        environment: matchingEvent?.environment ?? null,
        stacktraceMd: matchingEvent?.stacktraceMd ?? "",
      });
    }
    return claimed;
  });
}
