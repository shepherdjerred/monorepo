import { Database, type Statement } from "bun:sqlite";
import type {
  AdminMessageDetail,
  AdminMessageSummary,
  AdminMessagesResponse,
  AdminOverviewResponse,
  AttemptOutcome,
  MessageProtocol,
  MessageReceiptResponse,
  MessageStatus,
} from "@shepherdjerred/mail/shared/contract.ts";
import {
  initializeMailSchema,
  mapMessageReceipt,
  mapMessageSummary,
  parseMessageProtocol,
  parseMessageStatus,
  parseRecipientsJson,
  type MessageRow,
} from "./schema.ts";
import {
  queryMailOverview,
  queryMessageDetail,
  queryMessageList,
  queryStatusCounts,
  type ListMessagesFilter,
  type RelayOverviewMetadata,
} from "./store-queries.ts";

const MS_PER_DAY = 86_400_000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_LIMIT = 100;

export type MailStoreOpenOptions = {
  readonly nowIso?: string;
  readonly retentionDays?: number;
};

export type EnqueueMessageInput = {
  readonly clientId: string;
  readonly protocol: MessageProtocol;
  readonly idempotencyKey?: string | null;
  readonly rfcMessageId: string;
  readonly mailFrom: string;
  readonly recipients: readonly string[];
  readonly fromHeader: string;
  readonly toHeader: string;
  readonly subject: string;
  readonly tag?: string | null;
  readonly plainBody?: string | null;
  readonly htmlBody?: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawMime: Uint8Array;
  readonly nowIso?: string;
  readonly retentionDays?: number;
};

export type EnqueueMessageResult = {
  readonly message: AdminMessageSummary;
  readonly deduplicated: boolean;
};

export type ClaimedMessage = {
  readonly id: string;
  readonly clientId: string;
  readonly protocol: MessageProtocol;
  readonly rfcMessageId: string;
  readonly mailFrom: string;
  readonly recipients: string[];
  readonly rawMime: Uint8Array;
  readonly attemptCount: number;
  readonly createdAt: string;
};

export type RecordAttemptInput = {
  readonly messageId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly outcome: AttemptOutcome;
  readonly nextAttemptAt?: string;
  readonly smtpCode?: number | null;
  readonly smtpResponse?: string | null;
  readonly error?: string | null;
};

export type RetryMessageResult =
  | { readonly kind: "ok"; readonly message: AdminMessageDetail }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_status"; readonly status: MessageStatus };

export class MailStore {
  readonly #db: Database;
  readonly #livenessQuery: Statement<{ alive: number }, []>;
  #closed = false;

  private constructor(
    db: Database,
    databasePath: string,
    options?: MailStoreOpenOptions,
  ) {
    this.#db = db;
    initializeMailSchema(this.#db, databasePath);
    this.#livenessQuery = this.#db.query("SELECT 1 AS alive");
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const retentionDays = options?.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.recoverStrandedSending(nowIso);
    this.pruneExpired(retentionDays, nowIso, DEFAULT_PRUNE_LIMIT);
  }

  static open(
    databasePath = ":memory:",
    options?: MailStoreOpenOptions,
  ): MailStore {
    return new MailStore(
      new Database(databasePath, { create: true }),
      databasePath,
      options,
    );
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#livenessQuery.finalize();
      this.#db.close(false);
    }
  }

  ping(): boolean {
    if (this.#closed) {
      return false;
    }
    try {
      return this.#livenessQuery.get()?.alive === 1;
    } catch {
      return false;
    }
  }

  recoverStrandedSending(nowIso = new Date().toISOString()): number {
    const result = this.#db.run(
      `UPDATE messages
       SET status = 'retrying',
           next_attempt_at = ?,
           claimed_at = NULL,
           updated_at = ?
       WHERE status = 'sending'`,
      [nowIso, nowIso],
    );
    return result.changes;
  }

  pruneExpired(
    retentionDays: number,
    nowIso = new Date().toISOString(),
    limit = DEFAULT_PRUNE_LIMIT,
  ): number {
    if (retentionDays <= 0 || limit <= 0) {
      return 0;
    }
    const cutoffIso = new Date(
      new Date(nowIso).getTime() - retentionDays * MS_PER_DAY,
    ).toISOString();
    const result = this.#db.run(
      `DELETE FROM messages
       WHERE id IN (
         SELECT id FROM messages
         WHERE status IN ('sent', 'failed') AND created_at < ?
         ORDER BY created_at ASC
         LIMIT ?
       )`,
      [cutoffIso, limit],
    );
    return result.changes;
  }

  findByIdempotencyKey(
    clientId: string,
    idempotencyKey: string,
  ): AdminMessageSummary | null {
    const row = this.#db
      .query<MessageRow, [string, string]>(
        "SELECT * FROM messages WHERE client_id = ? AND idempotency_key = ?",
      )
      .get(clientId, idempotencyKey);
    return row === null ? null : mapMessageSummary(row);
  }

  enqueueMessage(input: EnqueueMessageInput): EnqueueMessageResult {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.pruneExpired(retentionDays, nowIso, DEFAULT_PRUNE_LIMIT);

    const normalizedKey =
      input.idempotencyKey !== undefined &&
      input.idempotencyKey !== null &&
      input.idempotencyKey.length > 0
        ? input.idempotencyKey
        : null;

    const runTx = this.#db.transaction((): EnqueueMessageResult => {
      if (normalizedKey !== null) {
        const existing = this.#db
          .query<MessageRow, [string, string]>(
            "SELECT * FROM messages WHERE client_id = ? AND idempotency_key = ?",
          )
          .get(input.clientId, normalizedKey);
        if (existing !== null) {
          return {
            message: mapMessageSummary(existing),
            deduplicated: true,
          };
        }
      }

      const id = crypto.randomUUID();
      this.#db.run(
        `INSERT INTO messages (
          id, client_id, protocol, idempotency_key, rfc_message_id,
          mail_from, rcpt_to_json, from_header, to_header, subject,
          tag, plain_body, html_body, headers_json, raw_mime,
          size_bytes, status, attempt_count, next_attempt_at, claimed_at,
          created_at, updated_at, sent_at, failed_at,
          last_smtp_code, last_smtp_response, last_error
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, 'queued', 0, ?, NULL,
          ?, ?, NULL, NULL,
          NULL, NULL, NULL
        )`,
        [
          id,
          input.clientId,
          input.protocol,
          normalizedKey,
          input.rfcMessageId,
          input.mailFrom,
          JSON.stringify(input.recipients),
          input.fromHeader,
          input.toHeader,
          input.subject,
          input.tag ?? null,
          input.plainBody ?? null,
          input.htmlBody ?? null,
          JSON.stringify(input.headers),
          input.rawMime,
          input.rawMime.byteLength,
          nowIso,
          nowIso,
          nowIso,
        ],
      );

      const inserted = this.#db
        .query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?")
        .get(id);
      if (inserted === null) {
        throw new Error(`Failed to read back inserted mail message ${id}`);
      }
      return {
        message: mapMessageSummary(inserted),
        deduplicated: false,
      };
    });

    return runTx();
  }

  countClientMessagesSince(clientId: string, sinceIso: string): number {
    const row = this.#db
      .query<{ c: number }, [string, string]>(
        "SELECT COUNT(*) AS c FROM messages WHERE client_id = ? AND created_at >= ?",
      )
      .get(clientId, sinceIso);
    return row?.c ?? 0;
  }

  claimNextDue(nowIso = new Date().toISOString()): ClaimedMessage | null {
    const runTx = this.#db.transaction((): ClaimedMessage | null => {
      const candidate = this.#db
        .query<MessageRow, [string]>(
          `SELECT * FROM messages
           WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ?
           ORDER BY next_attempt_at ASC, created_at ASC
           LIMIT 1`,
        )
        .get(nowIso);
      if (candidate === null) {
        return null;
      }

      this.#db.run(
        `UPDATE messages
         SET status = 'sending', claimed_at = ?, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, candidate.id],
      );

      return {
        id: candidate.id,
        clientId: candidate.client_id,
        protocol: parseMessageProtocol(candidate.protocol),
        rfcMessageId: candidate.rfc_message_id,
        mailFrom: candidate.mail_from,
        recipients: parseRecipientsJson(candidate.rcpt_to_json),
        rawMime: new Uint8Array(candidate.raw_mime),
        attemptCount: candidate.attempt_count,
        createdAt: candidate.created_at,
      };
    });

    return runTx();
  }

  nextDueTimestamp(): string | null {
    const row = this.#db
      .query<{ next_due: string | null }, []>(
        "SELECT MIN(next_attempt_at) AS next_due FROM messages WHERE status IN ('queued', 'retrying')",
      )
      .get();
    return row?.next_due ?? null;
  }

  recordAttempt(input: RecordAttemptInput): AdminMessageSummary {
    const runTx = this.#db.transaction((): AdminMessageSummary => {
      const existing = this.#db
        .query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?")
        .get(input.messageId);
      if (existing === null) {
        throw new Error(
          `Unknown message id in recordAttempt: ${input.messageId}`,
        );
      }

      const attemptNumber = existing.attempt_count + 1;
      const smtpCode = input.smtpCode ?? null;
      const smtpResponse = input.smtpResponse ?? null;
      const errorText = input.outcome === "sent" ? null : (input.error ?? null);

      this.#db.run(
        `INSERT INTO delivery_attempts (
          message_id, attempt_number, started_at, finished_at,
          duration_ms, outcome, smtp_code, smtp_response, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.messageId,
          attemptNumber,
          input.startedAt,
          input.finishedAt,
          input.durationMs,
          input.outcome,
          smtpCode,
          smtpResponse,
          errorText,
        ],
      );

      const nextStatus: MessageStatus =
        input.outcome === "sent"
          ? "sent"
          : input.outcome === "transient_error"
            ? "retrying"
            : "failed";
      const nextAttemptAt =
        input.outcome === "transient_error"
          ? (input.nextAttemptAt ?? input.finishedAt)
          : input.finishedAt;
      const sentAt =
        input.outcome === "sent" ? input.finishedAt : existing.sent_at;
      const failedAt =
        input.outcome === "permanent_error"
          ? input.finishedAt
          : input.outcome === "sent"
            ? null
            : existing.failed_at;

      this.#db.run(
        `UPDATE messages
         SET status = ?, attempt_count = ?, next_attempt_at = ?,
             claimed_at = NULL, updated_at = ?, sent_at = ?, failed_at = ?,
             last_smtp_code = ?, last_smtp_response = ?, last_error = ?
         WHERE id = ?`,
        [
          nextStatus,
          attemptNumber,
          nextAttemptAt,
          input.finishedAt,
          sentAt,
          failedAt,
          smtpCode,
          smtpResponse,
          errorText,
          input.messageId,
        ],
      );

      const updated = this.#db
        .query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?")
        .get(input.messageId);
      if (updated === null) {
        throw new Error(`Message disappeared after update: ${input.messageId}`);
      }
      return mapMessageSummary(updated);
    });

    return runTx();
  }

  retryMessage(
    id: string,
    nowIso = new Date().toISOString(),
  ): RetryMessageResult {
    const runTx = this.#db.transaction((): RetryMessageResult => {
      const existing = this.#db
        .query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?")
        .get(id);
      if (existing === null) {
        return { kind: "not_found" };
      }

      const status = parseMessageStatus(existing.status);
      if (status !== "failed" && status !== "retrying") {
        return { kind: "invalid_status", status };
      }

      this.#db.run(
        `UPDATE messages
         SET status = 'queued', next_attempt_at = ?, claimed_at = NULL,
             failed_at = NULL, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, id],
      );

      const detail = queryMessageDetail(this.#db, id);
      return detail === null
        ? { kind: "not_found" }
        : { kind: "ok", message: detail };
    });

    return runTx();
  }

  getReceipt(clientId: string, id: string): MessageReceiptResponse | null {
    const row = this.#db
      .query<MessageRow, [string, string]>(
        "SELECT * FROM messages WHERE id = ? AND client_id = ?",
      )
      .get(id, clientId);
    return row === null ? null : mapMessageReceipt(row);
  }

  statusCounts(): Record<MessageStatus, number> {
    return queryStatusCounts(this.#db);
  }

  getOverview(
    relay: RelayOverviewMetadata,
    configuredClientIds: readonly string[] = [],
    nowIso = new Date().toISOString(),
  ): AdminOverviewResponse {
    return queryMailOverview(this.#db, relay, configuredClientIds, nowIso);
  }

  listMessages(filter: ListMessagesFilter = {}): AdminMessagesResponse {
    return queryMessageList(this.#db, filter);
  }

  getMessageDetail(id: string): AdminMessageDetail | null {
    return queryMessageDetail(this.#db, id);
  }
}
