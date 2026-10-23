import type { Prisma, PrismaClient } from "#generated/prisma/client/index.js";
import type {
  AlertLedgerRepository,
  ClaimedPendingEmail,
  EmailSendFailureInput,
  EmailSendSuccessInput,
  IngestWebhookInput,
  IngestWebhookResult,
  PendingEmail,
  ReconcileSnapshotInput,
  ReconcileSnapshotResult,
  RetentionInput,
  RetentionResult,
} from "#application/ports";
import {
  openingEmail,
  truncationEmail,
  type AlertOccurrenceRecord,
} from "#domain/alert";
import { PrismaReadRepository } from "#infrastructure/prisma-read-repository";
import { AsyncMutex } from "#infrastructure/async-mutex";
import { createPrismaClient } from "#infrastructure/prisma-client";
import { reconcileSnapshotRows } from "#infrastructure/prisma-reconcile";
import { ingestWebhookAlert } from "#infrastructure/prisma-webhook-ingest";
import {
  claimPendingEmailRows,
  markEmailFailedRow,
  markEmailSentRow,
} from "#infrastructure/prisma-email-claim";
import {
  cancelPendingEmails,
  type CancelPendingEmailsInput,
  type CancelPendingEmailsResult,
} from "#infrastructure/prisma-email-cancellation";
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

const RECONCILIATION_TRANSACTION_MAX_WAIT_MS = 15_000;
const RECONCILIATION_TRANSACTION_TIMEOUT_MS = 60_000;
/**
 * Rows deleted per retention transaction. Small batches keep each write-lock
 * hold short, so a large first prune never stalls reconciliation.
 */
const RETENTION_BATCH_SIZE = 1000;

export async function createPrismaRepository(
  databaseUrl: string,
): Promise<PrismaAlertLedgerRepository> {
  return new PrismaAlertLedgerRepository(await createPrismaClient(databaseUrl));
}

export class PrismaAlertLedgerRepository implements AlertLedgerRepository {
  readonly #prisma: PrismaClient;
  readonly #read: PrismaReadRepository;
  readonly #writeMutex: AsyncMutex;

  /**
   * `writeMutex` is shared with every other repository over the same client:
   * SQLite admits one writer, and interleaved interactive transactions on one
   * connection would otherwise contend.
   */
  constructor(prisma: PrismaClient, writeMutex = new AsyncMutex()) {
    this.#prisma = prisma;
    this.#read = new PrismaReadRepository(prisma);
    this.#writeMutex = writeMutex;
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
            truncatedAlerts: input.payload.truncatedAlerts,
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
        const truncationOnly =
          newlyNotified.length === 0 && input.payload.truncatedAlerts > 0;
        if (
          input.emailEnabled &&
          (truncationOnly || newlyNotified.length > 0)
        ) {
          const message = truncationOnly
            ? truncationEmail(input.payload.truncatedAlerts)
            : openingEmail(newlyNotified, input.payload.truncatedAlerts);
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
        (transaction) => reconcileSnapshotRows(transaction, input),
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
      where: {
        sentAtNs: null,
        canceledAtNs: null,
        nextAttemptAtNs: { lte: nowNs },
      },
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

  async claimPendingEmails(
    nowNs: bigint,
    limit: number,
    sendingAtNs: bigint,
  ): Promise<readonly ClaimedPendingEmail[]> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction((transaction) =>
        claimPendingEmailRows(transaction, nowNs, limit, sendingAtNs),
      ),
    );
  }

  async cancelPendingEmails(
    input: CancelPendingEmailsInput,
  ): Promise<CancelPendingEmailsResult> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction((transaction) =>
        cancelPendingEmails(transaction, input),
      ),
    );
  }

  async markEmailSent(input: EmailSendSuccessInput): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction((transaction) =>
        markEmailSentRow(transaction, input),
      ),
    );
  }

  async markEmailFailed(input: EmailSendFailureInput): Promise<void> {
    await this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction((transaction) =>
        markEmailFailedRow(transaction, input),
      ),
    );
  }

  async purgeExpiredRecords(input: RetentionInput): Promise<RetentionResult> {
    return {
      webhookDeliveries: await this.#deleteInBatches((transaction) =>
        this.#deleteExpiredDeliveries(transaction, input.nowNs),
      ),
      snapshotRuns: await this.#deleteInBatches((transaction) =>
        this.#deleteExpiredSnapshotRuns(transaction, input.snapshotRunCutoffNs),
      ),
    };
  }

  async #deleteInBatches(
    deleteBatch: (transaction: Prisma.TransactionClient) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.#writeMutex.runExclusive(() =>
        this.#prisma.$transaction(deleteBatch),
      );
      total += deleted;
      if (deleted < RETENTION_BATCH_SIZE) return total;
    }
  }

  /**
   * Expired deliveries go entirely, not just their raw payload. Their
   * occurrence links cascade through the foreign key.
   */
  async #deleteExpiredDeliveries(
    transaction: Prisma.TransactionClient,
    nowNs: bigint,
  ): Promise<number> {
    const rows = await transaction.webhookDelivery.findMany({
      where: { rawExpiresAtNs: { lte: nowNs } },
      select: { id: true },
      take: RETENTION_BATCH_SIZE,
    });
    if (rows.length === 0) return 0;
    const deleted = await transaction.webhookDelivery.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return deleted.count;
  }

  /**
   * Snapshot runs are only read for the latest run and the latest successful
   * run, which are always kept so status and liveness survive any outage.
   */
  async #deleteExpiredSnapshotRuns(
    transaction: Prisma.TransactionClient,
    cutoffNs: bigint,
  ): Promise<number> {
    const latest = await Promise.all([
      transaction.snapshotRun.findFirst({
        orderBy: { completedAtNs: "desc" },
        select: { id: true },
      }),
      transaction.snapshotRun.findFirst({
        where: { status: "success" },
        orderBy: { completedAtNs: "desc" },
        select: { id: true },
      }),
    ]);
    const keep = latest.flatMap((row) => (row === null ? [] : [row.id]));
    const rows = await transaction.snapshotRun.findMany({
      where: { completedAtNs: { lt: cutoffNs }, id: { notIn: keep } },
      select: { id: true },
      take: RETENTION_BATCH_SIZE,
    });
    if (rows.length === 0) return 0;
    const deleted = await transaction.snapshotRun.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return deleted.count;
  }

  async disconnect(): Promise<void> {
    await this.#prisma.$disconnect();
  }
}
