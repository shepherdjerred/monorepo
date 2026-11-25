import { z } from "zod";
import {
  computeFingerprint,
  extractIssueSummary,
} from "#domain/fingerprint.ts";
import { evaluateIssueIngestion } from "#domain/lifecycle.ts";
import { renderStacktraceMarkdown } from "#domain/stacktrace-markdown.ts";
import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import {
  buildNewIssueAttributes,
  constantTimeStringEquals,
} from "#infrastructure/repository-helpers.ts";
import type {
  IngestEventInput,
  IngestEventResult,
} from "#infrastructure/repository-types.ts";

const PrismaPrimitiveJsonSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export function toPrismaJsonObject(
  record: Record<string, unknown>,
): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, value] of Object.entries(record)) {
    const converted = toPrismaJsonValue(value);
    if (converted !== undefined) {
      out[key] = converted;
    }
  }
  return out;
}

function toPrismaJsonValue(
  value: unknown,
): Prisma.InputJsonValue | null | undefined {
  if (value === null) {
    return null;
  }
  const primitive = PrismaPrimitiveJsonSchema.safeParse(value);
  if (primitive.success) {
    return primitive.data;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toPrismaJsonValue(entry) ?? null);
  }
  if (typeof value === "object") {
    const nested: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value)) {
      const converted = toPrismaJsonValue(v);
      if (converted !== undefined) {
        nested[k] = converted;
      }
    }
    return nested;
  }
  return undefined;
}

export async function syncProjectIdSequence(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    "SELECT setval(pg_get_serial_sequence('projects', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM projects), 99), true)",
  );
}

async function pruneOverflowEventsInTx(options: {
  readonly tx: Prisma.TransactionClient;
  readonly issueId: string;
  readonly projectId: number;
  readonly retentionMaxEvents: number;
}): Promise<void> {
  const { tx, issueId, projectId, retentionMaxEvents } = options;
  const totalStored = await tx.event.count({ where: { issueId } });
  const overflow = totalStored - retentionMaxEvents;
  if (overflow > 0) {
    const oldest = await tx.event.findMany({
      where: { issueId },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: overflow,
      select: { id: true },
    });
    if (oldest.length > 0) {
      const deleted = await tx.event.deleteMany({
        where: { id: { in: oldest.map((row) => row.id) } },
      });
      await tx.issue.update({
        where: { id: issueId },
        data: { storedEventCount: totalStored - deleted.count },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { storedEventCount: { decrement: deleted.count } },
      });
    }
  }
}

export async function executePrismaIngestEvent(
  prisma: PrismaClient,
  input: IngestEventInput,
): Promise<IngestEventResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
  });
  if (
    project === null ||
    !constantTimeStringEquals(project.publicKey, input.publicKey)
  ) {
    return { status: "unauthorized" };
  }

  const { normalizedEvent } = input;
  const existingEvent = await prisma.event.findUnique({
    where: {
      projectId_eventId: {
        projectId: project.id,
        eventId: normalizedEvent.eventId,
      },
    },
    select: { eventId: true, issueId: true },
  });
  if (existingEvent !== null) {
    return {
      status: "duplicate",
      eventId: existingEvent.eventId,
      issueId: existingEvent.issueId,
    };
  }

  const fingerprint = computeFingerprint(normalizedEvent);
  const summary = extractIssueSummary(normalizedEvent);
  const stacktraceMd = renderStacktraceMarkdown(normalizedEvent);

  return prisma.$transaction(async (tx) => {
    const raceDuplicate = await tx.event.findUnique({
      where: {
        projectId_eventId: {
          projectId: project.id,
          eventId: normalizedEvent.eventId,
        },
      },
      select: { eventId: true, issueId: true },
    });
    if (raceDuplicate !== null) {
      return {
        status: "duplicate",
        eventId: raceDuplicate.eventId,
        issueId: raceDuplicate.issueId,
      };
    }

    if (
      normalizedEvent.release !== null &&
      normalizedEvent.release.length > 0
    ) {
      await tx.release.upsert({
        where: {
          projectId_version: {
            projectId: project.id,
            version: normalizedEvent.release,
          },
        },
        create: {
          projectId: project.id,
          version: normalizedEvent.release,
          releasedAt: normalizedEvent.timestamp,
        },
        update: {},
      });
    }

    const fpMatch = await tx.issueFingerprint.findUnique({
      where: {
        projectId_fingerprint: {
          projectId: project.id,
          fingerprint,
        },
      },
      include: { issue: true },
    });

    const existingIssue = fpMatch?.issue ?? null;
    const decision = evaluateIssueIngestion({
      existingIssue:
        existingIssue === null
          ? null
          : {
              state: existingIssue.state,
              resolvedInRelease: existingIssue.resolvedInRelease,
              regressedCount: existingIssue.regressedCount,
              lastAlertedAt: existingIssue.lastAlertedAt,
            },
      incomingRelease: normalizedEvent.release,
      incomingTimestamp: normalizedEvent.timestamp,
      alertOnNewIssue: project.alertOnNewIssue,
      alertOnRegression: project.alertOnRegression,
    });

    let issueId: string;
    const isNewIssue = existingIssue === null;
    if (existingIssue === null) {
      const createdIssue = await tx.issue.create({
        data: buildNewIssueAttributes({
          projectId: project.id,
          primaryFingerprint: fingerprint,
          summary,
          decision,
          normalizedEvent,
        }),
      });
      issueId = createdIssue.id;
      await tx.issueFingerprint.create({
        data: {
          projectId: project.id,
          fingerprint,
          issueId,
        },
      });
    } else {
      issueId = existingIssue.id;
      const nextFirstSeen =
        normalizedEvent.timestamp.getTime() < existingIssue.firstSeen.getTime()
          ? normalizedEvent.timestamp
          : existingIssue.firstSeen;
      const nextLastSeen =
        normalizedEvent.timestamp.getTime() > existingIssue.lastSeen.getTime()
          ? normalizedEvent.timestamp
          : existingIssue.lastSeen;

      await tx.issue.update({
        where: { id: issueId },
        data: {
          type: summary.type,
          value: summary.value,
          transaction: summary.transaction,
          level: summary.level,
          state: decision.state,
          resolvedInRelease: decision.resolvedInRelease,
          regressedCount: decision.regressedCount,
          digestedEventCount: { increment: 1n },
          storedEventCount: { increment: 1 },
          firstSeen: nextFirstSeen,
          lastSeen: nextLastSeen,
          lastRelease: normalizedEvent.release ?? existingIssue.lastRelease,
          lastAlertedAt: decision.lastAlertedAt,
          revision: { increment: 1 },
        },
      });
    }

    await tx.event.create({
      data: {
        eventId: normalizedEvent.eventId,
        issueId,
        projectId: project.id,
        timestamp: normalizedEvent.timestamp,
        release: normalizedEvent.release,
        environment: normalizedEvent.environment,
        platform: normalizedEvent.platform,
        level: normalizedEvent.level,
        transaction: normalizedEvent.transaction,
        data: toPrismaJsonObject(normalizedEvent.rawData),
        stacktraceMd,
      },
    });

    await tx.project.update({
      where: { id: project.id },
      data: {
        digestedEventCount: { increment: 1n },
        storedEventCount: { increment: 1 },
      },
    });

    await pruneOverflowEventsInTx({
      tx,
      issueId,
      projectId: project.id,
      retentionMaxEvents: project.retentionMaxEvents,
    });

    let outboxId: string | null = null;
    if (decision.outboxKind !== null) {
      const messageId = `errors-${decision.outboxKind.toLowerCase()}-${issueId}-${normalizedEvent.eventId}`;
      const outbox = await tx.notificationOutbox.create({
        data: {
          issueId,
          eventId: normalizedEvent.eventId,
          kind: decision.outboxKind,
          messageId,
        },
      });
      outboxId = outbox.id;
    }

    return {
      status: "accepted",
      eventId: normalizedEvent.eventId,
      issueId,
      outboxId,
      isNewIssue,
      regressed: decision.regressed,
    };
  });
}
