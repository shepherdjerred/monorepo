import { PrismaLibSql } from "@prisma/adapter-libsql";

import { Prisma, PrismaClient } from "#generated/prisma/client/index.js";
import type {
  AlertLedgerRepository,
  IngestWebhookInput,
  IngestWebhookResult,
  PendingEmail,
  ReconcileSnapshotInput,
  ReconcileSnapshotResult,
} from "#application/ports";
import {
  eventId,
  normalizeGeneratorUrl,
  occurrenceId,
  openingEmail,
  severityFromLabels,
  snapshotStartNs,
  summaryFromMetadata,
  suppressionFromSnapshot,
  type AlertOccurrenceRecord,
} from "#domain/alert";
import { PrismaReadRepository } from "#infrastructure/prisma-read-repository";
import { AsyncMutex } from "#infrastructure/async-mutex";
import { replaceOccurrenceLabels } from "#infrastructure/prisma-labels";
import { findObservedOccurrence } from "#infrastructure/prisma-occurrence";
import { ingestWebhookAlert } from "#infrastructure/prisma-webhook-ingest";
import {
  DeliveryIdSchema,
  OutboxIdSchema,
  SnapshotRunIdSchema,
  type AlertDetail,
  type AlertDetailInput,
  type AlertListInput,
  type AlertListResponse,
  type EventListInput,
  type EventListResponse,
  type Summary,
  type SystemStatus,
} from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

const RECONCILIATION_TRANSACTION_MAX_WAIT_MS = 15_000;
const RECONCILIATION_TRANSACTION_TIMEOUT_MS = 60_000;

export async function createPrismaRepository(
  databaseUrl: string,
): Promise<PrismaAlertLedgerRepository> {
  const adapter = new PrismaLibSql({ url: databaseUrl, intMode: "bigint" });
  const prisma = new PrismaClient({ adapter });
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
  return new PrismaAlertLedgerRepository(prisma);
}

export class PrismaAlertLedgerRepository implements AlertLedgerRepository {
  readonly #prisma: PrismaClient;
  readonly #read: PrismaReadRepository;
  readonly #writeMutex = new AsyncMutex();

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
    this.#read = new PrismaReadRepository(prisma);
  }

  async ingestWebhook(input: IngestWebhookInput): Promise<IngestWebhookResult> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction(async (transaction) => {
        const deliveryId = DeliveryIdSchema.parse(crypto.randomUUID());
        let opened = 0;
        let resolved = 0;
        const newlyNotified: AlertOccurrenceRecord[] = [];
        const observedOccurrenceIds = new Set<string>();
        for (const alert of input.payload.alerts) {
          const result = await ingestWebhookAlert(
            transaction,
            alert,
            input.receivedAtNs,
          );
          opened += result.opened;
          resolved += result.resolved;
          observedOccurrenceIds.add(result.occurrenceId);
          if (result.notified !== null) newlyNotified.push(result.notified);
        }

        await transaction.webhookDelivery.create({
          data: {
            id: deliveryId,
            receivedAtNs: input.receivedAtNs,
            groupKey: input.payload.groupKey,
            status: input.payload.status,
            receiver: input.payload.receiver,
            ...(input.payload.notification_reason === undefined
              ? {}
              : { notificationReason: input.payload.notification_reason }),
            payloadHash: input.payloadHash,
            occurrenceIds: [...observedOccurrenceIds],
            rawPayload: input.rawPayload,
            rawExpiresAtNs: input.rawExpiresAtNs,
            occurrenceLinks: {
              create: [...observedOccurrenceIds].map((linkedOccurrenceId) => ({
                occurrence: { connect: { id: linkedOccurrenceId } },
              })),
            },
          },
        });

        let emailQueued = false;
        if (input.emailEnabled && newlyNotified.length > 0) {
          const message = openingEmail(newlyNotified);
          await transaction.emailOutbox.create({
            data: {
              id: OutboxIdSchema.parse(crypto.randomUUID()),
              createdAtNs: input.receivedAtNs,
              nextAttemptAtNs: input.receivedAtNs,
              messageId: `<alerts-${deliveryId}@sjer.red>`,
              deliveryId,
              occurrenceIds: newlyNotified.map((alert) => alert.id),
              subject: message.subject,
              htmlBody: message.htmlBody,
            },
          });
          emailQueued = true;
        }
        return { deliveryId, opened, resolved, emailQueued };
      }),
    );
  }

  async reconcileSnapshot(
    input: ReconcileSnapshotInput,
  ): Promise<ReconcileSnapshotResult> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction(
        async (transaction) => {
          const activeIds = new Set<string>();
          let opened = 0;
          let resolved = 0;
          for (const alert of input.alerts) {
            const startedAtNs = snapshotStartNs(alert);
            const id = occurrenceId(alert.fingerprint, startedAtNs);
            const suppressionState = suppressionFromSnapshot(alert);
            const existing = await findObservedOccurrence(
              transaction,
              alert.fingerprint,
              startedAtNs,
            );
            if (existing === null) {
              activeIds.add(id);
              await transaction.alertOccurrence.create({
                data: {
                  id,
                  source: "alertmanager",
                  fingerprint: alert.fingerprint,
                  startedAtNs,
                  openedAtNs: startedAtNs,
                  lastSeenAtNs: input.completedAtNs,
                  lifecycleState: "open",
                  suppressionState,
                  alertname: alert.labels["alertname"] ?? "UnnamedAlert",
                  namespace: alert.labels["namespace"] ?? null,
                  severity: severityFromLabels(alert.labels),
                  summary: summaryFromMetadata(alert.labels, alert.annotations),
                  generatorUrl: normalizeGeneratorUrl(alert.generatorURL),
                  labels: alert.labels,
                  annotations: alert.annotations,
                },
              });
              await replaceOccurrenceLabels(transaction, id, alert.labels);
              await transaction.alertEvent.create({
                data: {
                  id: eventId(id, "opened", startedAtNs),
                  occurrenceId: id,
                  type: "opened",
                  occurredAtNs: startedAtNs,
                  source: "snapshot",
                },
              });
              opened += 1;
              continue;
            }
            activeIds.add(existing.id);
            const suppressionChanged =
              existing.suppressionState !== suppressionState;
            const shouldReopen =
              existing.lifecycleState === "resolved" &&
              existing.resolutionSource === "reconciled";
            await transaction.alertOccurrence.update({
              where: { id: existing.id },
              data: {
                lastSeenAtNs: input.completedAtNs,
                missingSinceNs: null,
                absentSnapshots: 0,
                suppressionState,
                alertname: alert.labels["alertname"] ?? "UnnamedAlert",
                namespace: alert.labels["namespace"] ?? null,
                severity: severityFromLabels(alert.labels),
                summary: summaryFromMetadata(alert.labels, alert.annotations),
                generatorUrl: normalizeGeneratorUrl(alert.generatorURL),
                labels: alert.labels,
                annotations: alert.annotations,
                ...(shouldReopen
                  ? {
                      lifecycleState: "open",
                      resolvedAtNs: null,
                      resolutionSource: null,
                    }
                  : {}),
              },
            });
            await replaceOccurrenceLabels(
              transaction,
              existing.id,
              alert.labels,
            );
            if (shouldReopen) {
              await transaction.alertEvent.create({
                data: {
                  id: eventId(
                    existing.id,
                    "reopened_reconciled",
                    input.completedAtNs,
                  ),
                  occurrenceId: existing.id,
                  type: "opened",
                  occurredAtNs: input.completedAtNs,
                  source: "reconciliation",
                  detail: { previousResolutionSource: "reconciled" },
                },
              });
              opened += 1;
            }
            if (suppressionChanged) {
              await transaction.alertEvent.create({
                data: {
                  id: eventId(
                    existing.id,
                    `suppression_changed_${suppressionState}`,
                    input.completedAtNs,
                  ),
                  occurrenceId: existing.id,
                  type: "suppression_changed",
                  occurredAtNs: input.completedAtNs,
                  source: "snapshot",
                  detail: {
                    from: existing.suppressionState,
                    to: suppressionState,
                  },
                },
              });
            }
          }

          const openOccurrences = await transaction.alertOccurrence.findMany({
            where: {
              lifecycleState: "open",
              lastSeenAtNs: { lte: input.startedAtNs },
            },
          });
          for (const occurrence of openOccurrences) {
            if (activeIds.has(occurrence.id)) continue;
            const missingSinceNs =
              occurrence.missingSinceNs ?? input.completedAtNs;
            const absentSnapshots = occurrence.absentSnapshots + 1;
            const pastGrace =
              input.completedAtNs - missingSinceNs >= input.missingGraceNs;
            if (pastGrace && absentSnapshots >= 2) {
              await transaction.alertOccurrence.update({
                where: { id: occurrence.id },
                data: {
                  lifecycleState: "resolved",
                  resolvedAtNs: input.completedAtNs,
                  resolutionSource: "reconciled",
                  missingSinceNs,
                  absentSnapshots,
                },
              });
              await transaction.alertEvent.create({
                data: {
                  id: eventId(
                    occurrence.id,
                    "resolved_reconciled",
                    input.completedAtNs,
                  ),
                  occurrenceId: occurrence.id,
                  type: "resolved",
                  occurredAtNs: input.completedAtNs,
                  source: "reconciliation",
                  detail: { absentSnapshots },
                },
              });
              resolved += 1;
            } else {
              await transaction.alertOccurrence.update({
                where: { id: occurrence.id },
                data: { missingSinceNs, absentSnapshots },
              });
              if (occurrence.missingSinceNs === null) {
                await transaction.alertEvent.create({
                  data: {
                    id: eventId(
                      occurrence.id,
                      "reconciliation_discrepancy",
                      input.completedAtNs,
                    ),
                    occurrenceId: occurrence.id,
                    type: "reconciliation_discrepancy",
                    occurredAtNs: input.completedAtNs,
                    source: "reconciliation",
                    detail: { absentSnapshots },
                  },
                });
              }
            }
          }

          await transaction.snapshotRun.create({
            data: {
              id: SnapshotRunIdSchema.parse(crypto.randomUUID()),
              startedAtNs: input.startedAtNs,
              completedAtNs: input.completedAtNs,
              status: "success",
              activeCount: input.alerts.length,
              openedCount: opened,
              resolvedCount: resolved,
            },
          });
          return { active: input.alerts.length, opened, resolved };
        },
        {
          maxWait: RECONCILIATION_TRANSACTION_MAX_WAIT_MS,
          timeout: RECONCILIATION_TRANSACTION_TIMEOUT_MS,
        },
      ),
    );
  }

  async recordSnapshotFailure(
    startedAtNs: bigint,
    completedAtNs: bigint,
    error: string,
  ): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.snapshotRun.create({
        data: {
          id: SnapshotRunIdSchema.parse(crypto.randomUUID()),
          startedAtNs,
          completedAtNs,
          status: "error",
          activeCount: 0,
          openedCount: 0,
          resolvedCount: 0,
          error,
        },
      }),
    );
  }

  async listAlerts(input: AlertListInput): Promise<AlertListResponse> {
    return this.#read.listAlerts(input);
  }

  async getAlert(input: AlertDetailInput): Promise<AlertDetail | null> {
    return this.#read.getAlert(input);
  }

  async listEvents(input: EventListInput): Promise<EventListResponse> {
    return this.#read.listEvents(input);
  }

  async summary(): Promise<Summary> {
    return this.#read.summary();
  }

  async checkDatabase(): Promise<void> {
    await this.#prisma.snapshotRun.findFirst({ select: { id: true } });
  }

  async systemStatus(
    emailEnabled: boolean,
    nowNs: bigint,
  ): Promise<SystemStatus> {
    return this.#read.systemStatus(emailEnabled, nowNs);
  }

  async pendingEmails(
    nowNs: bigint,
    limit: number,
  ): Promise<readonly PendingEmail[]> {
    return this.#prisma.emailOutbox.findMany({
      where: { sentAtNs: null, nextAttemptAtNs: { lte: nowNs } },
      orderBy: { nextAttemptAtNs: "asc" },
      take: limit,
      select: {
        id: true,
        messageId: true,
        subject: true,
        htmlBody: true,
        attemptCount: true,
      },
    });
  }

  async markEmailSent(id: string, sentAtNs: bigint): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.emailOutbox.update({
        where: { id },
        data: { sentAtNs, attemptCount: { increment: 1 }, lastError: null },
      }),
    );
  }

  async markEmailFailed(
    id: string,
    failedAtNs: bigint,
    nextAttemptAtNs: bigint,
    error: string,
  ): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.emailOutbox.update({
        where: { id },
        data: {
          nextAttemptAtNs,
          attemptCount: { increment: 1 },
          lastError: `${epochNanosecondsToInstantText(failedAtNs)} ${error}`,
        },
      }),
    );
  }

  async purgeExpiredRawPayloads(nowNs: bigint): Promise<number> {
    const result = await this.#writeMutex.runExclusive(() =>
      this.#prisma.webhookDelivery.updateMany({
        where: {
          rawPayload: { not: Prisma.DbNull },
          rawExpiresAtNs: { lte: nowNs },
        },
        data: { rawPayload: Prisma.DbNull },
      }),
    );
    return result.count;
  }

  async disconnect(): Promise<void> {
    await this.#prisma.$disconnect();
  }
}
