import { parseSnapshot } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";

import type { PrismaClient } from "#generated/prisma/client/index.js";
import type {
  AlertChangeQuery,
  ChangeQuery,
  DigestClaim,
  DigestRunKey,
  IncidentWindowStats,
  OpsRepository,
  StoreOpsSnapshotInput,
  StoreOpsSnapshotResult,
  StoredOpsSnapshot,
  ViewerCursorRecord,
} from "#application/ports";
import type { AlertLedgerChange } from "#domain/ops-changes";
import { prunableSnapshotIds } from "#domain/ops-retention";
import type { AsyncMutex } from "#infrastructure/async-mutex";
import {
  ChangeViewSchema,
  CursorConsumerSchema,
  type ChangeView,
  type CursorConsumer,
} from "#shared/ops-schema";
import { SeveritySchema as AlertSeveritySchema } from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

const SeenSignalIdsSchema = z.array(z.string());
const DigestStatusSchema = z.enum(["sending", "sent", "failed", "skipped"]);
const INCIDENT_SEVERITIES = ["critical", "warning"];

type SnapshotRow = {
  id: string;
  generatedAtNs: bigint;
  receivedAtNs: bigint;
  payload: unknown;
};

type ChangeRow = {
  id: string;
  source: string;
  externalId: string;
  service: string | null;
  kind: string;
  title: string;
  occurredAtNs: bigint;
  severity: string;
  url: string | null;
};

function toStoredSnapshot(row: SnapshotRow): StoredOpsSnapshot {
  return {
    id: row.id,
    generatedAtNs: row.generatedAtNs,
    receivedAtNs: row.receivedAtNs,
    snapshot: parseSnapshot(row.payload),
  };
}

function toChangeView(row: ChangeRow): ChangeView {
  return ChangeViewSchema.parse({
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    kind: row.kind,
    ...(row.service === null ? {} : { service: row.service }),
    title: row.title,
    occurredAt: epochNanosecondsToInstantText(row.occurredAtNs),
    severity: row.severity,
    ...(row.url === null ? {} : { url: row.url }),
  });
}

function nsRange(
  sinceNs: bigint | undefined,
  untilNs: bigint | undefined,
): { gte?: bigint; lt?: bigint } {
  return {
    ...(sinceNs === undefined ? {} : { gte: sinceNs }),
    ...(untilNs === undefined ? {} : { lt: untilNs }),
  };
}

export class PrismaOpsRepository implements OpsRepository {
  readonly #prisma: PrismaClient;
  readonly #writeMutex: AsyncMutex;

  constructor(prisma: PrismaClient, writeMutex: AsyncMutex) {
    this.#prisma = prisma;
    this.#writeMutex = writeMutex;
  }

  async storeSnapshot(
    input: StoreOpsSnapshotInput,
  ): Promise<StoreOpsSnapshotResult> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction(async (transaction) => {
        const snapshotId = crypto.randomUUID();
        await transaction.opsSnapshot.create({
          data: {
            id: snapshotId,
            generatedAtNs: input.generatedAtNs,
            receivedAtNs: input.receivedAtNs,
            severity: input.snapshot.severity,
            payload: input.snapshot,
          },
        });
        for (const change of input.changes) {
          const fields = {
            kind: change.kind,
            service: change.service ?? null,
            title: change.title,
            occurredAtNs: change.occurredAtNs,
            severity: change.severity,
            url: change.url ?? null,
          };
          await transaction.changeEvent.upsert({
            where: {
              source_externalId: {
                source: change.source,
                externalId: change.externalId,
              },
            },
            create: {
              id: crypto.randomUUID(),
              source: change.source,
              externalId: change.externalId,
              receivedAtNs: input.receivedAtNs,
              ...fields,
            },
            update: fields,
          });
        }
        const rows = await transaction.opsSnapshot.findMany({
          select: { id: true, generatedAtNs: true },
        });
        const prunable = prunableSnapshotIds(
          rows,
          input.receivedAtNs,
          input.retentionDays,
        );
        const deleted =
          prunable.length === 0
            ? { count: 0 }
            : await transaction.opsSnapshot.deleteMany({
                where: { id: { in: prunable } },
              });
        const pruned = deleted.count;
        return { snapshotId, changesUpserted: input.changes.length, pruned };
      }),
    );
  }

  async latestSnapshot(): Promise<StoredOpsSnapshot | null> {
    const row = await this.#prisma.opsSnapshot.findFirst({
      orderBy: [{ generatedAtNs: "desc" }, { id: "desc" }],
    });
    return row === null ? null : toStoredSnapshot(row);
  }

  async snapshotAtOrBefore(
    targetNs: bigint,
  ): Promise<StoredOpsSnapshot | null> {
    const row = await this.#prisma.opsSnapshot.findFirst({
      where: { generatedAtNs: { lte: targetNs } },
      orderBy: [{ generatedAtNs: "desc" }, { id: "desc" }],
    });
    return row === null ? null : toStoredSnapshot(row);
  }

  async listChanges(query: ChangeQuery): Promise<ChangeView[]> {
    const rows = await this.#prisma.changeEvent.findMany({
      where: {
        ...(query.service === undefined ? {} : { service: query.service }),
        occurredAtNs: nsRange(query.sinceNs, query.untilNs),
      },
      orderBy: [{ occurredAtNs: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return rows.map((row) => toChangeView(row));
  }

  async countChanges(input: {
    kind: ChangeView["kind"];
    sinceNs: bigint;
    untilNs: bigint;
  }): Promise<number> {
    return this.#prisma.changeEvent.count({
      where: {
        kind: input.kind,
        occurredAtNs: nsRange(input.sinceNs, input.untilNs),
      },
    });
  }

  async alertChanges(query: AlertChangeQuery): Promise<AlertLedgerChange[]> {
    const rows = await this.#prisma.alertEvent.findMany({
      where: {
        type: { in: ["opened", "resolved"] },
        occurredAtNs: nsRange(query.sinceNs, query.untilNs),
        ...(query.namespaces === undefined
          ? {}
          : { occurrence: { namespace: { in: [...query.namespaces] } } }),
      },
      include: {
        occurrence: {
          select: {
            alertname: true,
            namespace: true,
            severity: true,
            summary: true,
          },
        },
      },
      orderBy: [{ occurredAtNs: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return rows.map((row) => ({
      eventId: row.id,
      occurrenceId: row.occurrenceId,
      type: z.enum(["opened", "resolved"]).parse(row.type),
      occurredAtNs: row.occurredAtNs,
      alertname: row.occurrence.alertname,
      namespace: row.occurrence.namespace,
      severity: AlertSeveritySchema.parse(row.occurrence.severity),
      summary: row.occurrence.summary,
    }));
  }

  async incidentStats(input: {
    sinceNs: bigint;
    untilNs: bigint;
  }): Promise<IncidentWindowStats> {
    const [opened, resolved] = await Promise.all([
      this.#prisma.alertOccurrence.count({
        where: {
          severity: { in: INCIDENT_SEVERITIES },
          openedAtNs: nsRange(input.sinceNs, input.untilNs),
        },
      }),
      this.#prisma.alertOccurrence.findMany({
        where: {
          severity: { in: INCIDENT_SEVERITIES },
          resolvedAtNs: nsRange(input.sinceNs, input.untilNs),
        },
        select: { openedAtNs: true, resolvedAtNs: true },
      }),
    ]);
    return {
      opened,
      resolveDurationsNs: resolved.flatMap((row) =>
        row.resolvedAtNs === null ? [] : [row.resolvedAtNs - row.openedAtNs],
      ),
    };
  }

  async getCursor(
    consumer: CursorConsumer,
  ): Promise<ViewerCursorRecord | null> {
    const row = await this.#prisma.viewerCursor.findUnique({
      where: { consumer },
    });
    if (row === null) return null;
    return {
      consumer: CursorConsumerSchema.parse(row.consumer),
      lastSeenAtNs: row.lastSeenAtNs,
      seenSignalIds: SeenSignalIdsSchema.parse(row.seenSignalIds),
    };
  }

  async putCursor(record: ViewerCursorRecord): Promise<void> {
    const data = {
      lastSeenAtNs: record.lastSeenAtNs,
      seenSignalIds: [...record.seenSignalIds],
    };
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.viewerCursor.upsert({
        where: { consumer: record.consumer },
        create: { consumer: record.consumer, ...data },
        update: data,
      }),
    );
  }

  async recordDigestSkip(
    key: DigestRunKey,
    nowNs: bigint,
  ): Promise<{ created: boolean; status: "sent" | "skipped" | "pending" }> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction(async (transaction) => {
        const existing = await transaction.digestRun.findUnique({
          where: {
            kind_periodKey: { kind: key.kind, periodKey: key.periodKey },
          },
        });
        if (existing === null) {
          await transaction.digestRun.create({
            data: {
              id: crypto.randomUUID(),
              kind: key.kind,
              periodKey: key.periodKey,
              messageId: key.messageId,
              status: "skipped",
              createdAtNs: nowNs,
            },
          });
          return { created: true, status: "skipped" as const };
        }
        const status = DigestStatusSchema.parse(existing.status);
        return {
          created: false,
          status:
            status === "sent" || status === "skipped" ? status : "pending",
        };
      }),
    );
  }

  async claimDigestRun(
    key: DigestRunKey,
    nowNs: bigint,
    staleBeforeNs: bigint,
  ): Promise<DigestClaim> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction(async (transaction): Promise<DigestClaim> => {
        const where = {
          kind_periodKey: { kind: key.kind, periodKey: key.periodKey },
        };
        const existing = await transaction.digestRun.findUnique({ where });
        if (existing === null) {
          await transaction.digestRun.create({
            data: {
              id: crypto.randomUUID(),
              kind: key.kind,
              periodKey: key.periodKey,
              messageId: key.messageId,
              status: "sending",
              createdAtNs: nowNs,
              claimedAtNs: nowNs,
              attemptCount: 1,
            },
          });
          return { outcome: "claimed" };
        }
        const status = DigestStatusSchema.parse(existing.status);
        if (status === "sent" || status === "skipped")
          return { outcome: "done", status };
        if (
          status === "sending" &&
          existing.claimedAtNs !== null &&
          existing.claimedAtNs > staleBeforeNs
        )
          return { outcome: "busy" };
        await transaction.digestRun.update({
          where,
          data: {
            status: "sending",
            claimedAtNs: nowNs,
            attemptCount: { increment: 1 },
          },
        });
        return { outcome: "claimed" };
      }),
    );
  }

  async markDigestSent(
    key: DigestRunKey,
    input: { sentAtNs: bigint; subject: string },
  ): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.digestRun.update({
        where: {
          kind_periodKey: { kind: key.kind, periodKey: key.periodKey },
        },
        data: {
          status: "sent",
          sentAtNs: input.sentAtNs,
          subject: input.subject,
          lastError: null,
        },
      }),
    );
  }

  async markDigestFailed(key: DigestRunKey, error: string): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.digestRun.update({
        where: {
          kind_periodKey: { kind: key.kind, periodKey: key.periodKey },
        },
        data: { status: "failed", lastError: error.slice(0, 2000) },
      }),
    );
  }
}
