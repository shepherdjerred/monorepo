import {
  FacetKeySchema,
  type FacetKey,
  type OpsFacets,
} from "@shepherdjerred/ops-model/facets.ts";
import { parseSnapshot } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type {
  AlertChangeQuery,
  ChangeQuery,
  CompletedDailyDigestSummary,
  DigestArchiveFields,
  DigestClaim,
  DigestRunKey,
  IncidentWindowStats,
  OpsRepository,
  StoreOpsSnapshotInput,
  StoreOpsSnapshotResult,
  StoredOpsFacet,
  StoredOpsSnapshot,
  ViewerCursorRecord,
} from "#application/ports";
import type { AlertLedgerChange } from "#domain/ops-changes";
import {
  buildAllFacetsView,
  extractFacetEntries,
  INCIDENT_SEVERITIES,
  nsRange,
  parseFacetPayload,
  sameChangeFields,
  SeenSignalIdsSchema,
  toChangeView,
  type CachedFacet,
} from "#domain/ops-facet-mappers";
import { prunableSnapshotIds, retentionCutoffNs } from "#domain/ops-retention";
import type { AsyncMutex } from "#infrastructure/async-mutex";
import {
  claimDigestRunTransaction,
  markDigestFailedRow,
  markDigestSentRow,
  markDigestSkippedRow,
  previousCompletedDailyDigestRow,
} from "#infrastructure/reports/prisma-digest-mutations";
import {
  CursorConsumerSchema,
  type ChangeView,
  type CursorConsumer,
} from "#shared/ops-schema";
import {
  JsonObjectSchema,
  SeveritySchema as AlertSeveritySchema,
} from "#shared/schema";

type SnapshotRow = {
  id: string;
  generatedAtNs: bigint;
  receivedAtNs: bigint;
  payload: unknown;
};

function toStoredSnapshot(row: SnapshotRow): StoredOpsSnapshot {
  return {
    id: row.id,
    generatedAtNs: row.generatedAtNs,
    receivedAtNs: row.receivedAtNs,
    snapshot: parseSnapshot(row.payload),
  };
}

export class PrismaOpsRepository implements OpsRepository {
  readonly #prisma: PrismaClient;
  readonly #writeMutex: AsyncMutex;
  readonly #facetCache = new Map<FacetKey, CachedFacet>();
  #allFacetsHydrated = false;

  constructor(prisma: PrismaClient, writeMutex: AsyncMutex) {
    this.#prisma = prisma;
    this.#writeMutex = writeMutex;
  }

  async storeSnapshot(
    input: StoreOpsSnapshotInput,
  ): Promise<StoreOpsSnapshotResult> {
    const facetEntries = extractFacetEntries(input.facets);
    return this.#writeMutex.runExclusive(async () => {
      const result = await this.#prisma.$transaction(async (transaction) => {
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
        for (const [key, value] of facetEntries) {
          const facetData = {
            generatedAtNs: input.generatedAtNs,
            receivedAtNs: input.receivedAtNs,
            payload: JsonObjectSchema.parse(value),
          };
          await transaction.opsFacet.upsert({
            where: { key },
            create: { key, ...facetData },
            update: facetData,
          });
        }
        for (const change of input.changes) {
          const fields = {
            kind: change.kind,
            service: change.service ?? null,
            title: change.title,
            occurredAtNs: change.occurredAtNs,
            severity: change.severity,
            url: change.url ?? null,
          };
          const where = {
            source_externalId: {
              source: change.source,
              externalId: change.externalId,
            },
          };
          const stored = await transaction.changeEvent.findUnique({ where });
          if (stored === null) {
            await transaction.changeEvent.create({
              data: {
                id: crypto.randomUUID(),
                source: change.source,
                externalId: change.externalId,
                receivedAtNs: input.receivedAtNs,
                ...fields,
              },
            });
          } else if (!sameChangeFields(stored, fields)) {
            await transaction.changeEvent.update({ where, data: fields });
          }
        }
        const cutoffNs = retentionCutoffNs(
          input.receivedAtNs,
          input.retentionDays,
        );
        await transaction.changeEvent.deleteMany({
          where: { occurredAtNs: { lt: cutoffNs } },
        });
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
        return {
          snapshotId,
          changesUpserted: input.changes.length,
          pruned: deleted.count,
        };
      });
      for (const [key, value] of facetEntries) {
        this.#facetCache.set(key, {
          generatedAtNs: input.generatedAtNs,
          receivedAtNs: input.receivedAtNs,
          data: value,
        });
      }
      return result;
    });
  }

  async latestSnapshot(): Promise<StoredOpsSnapshot | null> {
    const row = await this.#prisma.opsSnapshot.findFirst({
      orderBy: [{ generatedAtNs: "desc" }, { id: "desc" }],
    });
    return row === null ? null : toStoredSnapshot(row);
  }

  async latestSnapshotReceivedAtNs(): Promise<bigint | null> {
    const row = await this.#prisma.opsSnapshot.findFirst({
      orderBy: [{ generatedAtNs: "desc" }, { id: "desc" }],
      select: { receivedAtNs: true },
    });
    return row?.receivedAtNs ?? null;
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

  async getFacet<K extends FacetKey>(
    key: K,
  ): Promise<StoredOpsFacet<K> | null> {
    const cached = this.#facetCache.get(key);
    if (cached !== undefined) {
      return {
        key,
        generatedAtNs: cached.generatedAtNs,
        receivedAtNs: cached.receivedAtNs,
        data: parseFacetPayload(key, cached.data),
      };
    }
    const row = await this.#prisma.opsFacet.findUnique({ where: { key } });
    if (row === null) {
      return null;
    }
    const data = parseFacetPayload(key, row.payload);
    this.#facetCache.set(key, {
      generatedAtNs: row.generatedAtNs,
      receivedAtNs: row.receivedAtNs,
      data,
    });
    return {
      key,
      generatedAtNs: row.generatedAtNs,
      receivedAtNs: row.receivedAtNs,
      data,
    };
  }

  async getAllFacets(): Promise<{
    facets: OpsFacets;
    receivedAtNs: bigint | null;
    generatedAtNs: bigint | null;
  }> {
    if (!this.#allFacetsHydrated) {
      const rows = await this.#prisma.opsFacet.findMany();
      for (const row of rows) {
        const parsedKey = FacetKeySchema.safeParse(row.key);
        if (!parsedKey.success) {
          continue;
        }
        const existing = this.#facetCache.get(parsedKey.data);
        if (
          existing === undefined ||
          row.receivedAtNs >= existing.receivedAtNs
        ) {
          this.#facetCache.set(parsedKey.data, {
            generatedAtNs: row.generatedAtNs,
            receivedAtNs: row.receivedAtNs,
            data: parseFacetPayload(parsedKey.data, row.payload),
          });
        }
      }
      this.#allFacetsHydrated = true;
    }
    return buildAllFacetsView(this.#facetCache);
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
    const opsOnly = {
      labelEntries: { none: { key: "category", value: "household" } },
    };
    const [opened, resolved] = await Promise.all([
      this.#prisma.alertOccurrence.count({
        where: {
          ...opsOnly,
          severity: { in: INCIDENT_SEVERITIES },
          openedAtNs: nsRange(input.sinceNs, input.untilNs),
        },
      }),
      this.#prisma.alertOccurrence.findMany({
        where: {
          ...opsOnly,
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
    return row === null
      ? null
      : {
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

  async claimDigestRun(
    key: DigestRunKey,
    nowNs: bigint,
    staleBeforeNs: bigint,
  ): Promise<DigestClaim> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction((transaction) =>
        claimDigestRunTransaction(transaction, key, nowNs, staleBeforeNs),
      ),
    );
  }

  async markDigestSent(
    key: DigestRunKey,
    input: { sentAtNs: bigint; subject: string } & DigestArchiveFields,
  ): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      markDigestSentRow(this.#prisma, key, input),
    );
  }

  async markDigestSkipped(
    key: DigestRunKey,
    input: {
      skipReason: string;
      subject: string;
    } & Required<DigestArchiveFields>,
  ): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      markDigestSkippedRow(this.#prisma, key, input),
    );
  }

  async markDigestFailed(key: DigestRunKey, error: string): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      markDigestFailedRow(this.#prisma, key, error),
    );
  }

  async previousCompletedDailyDigest(
    beforePeriodKey: string,
  ): Promise<CompletedDailyDigestSummary | null> {
    return previousCompletedDailyDigestRow(this.#prisma, beforePeriodKey);
  }
}
