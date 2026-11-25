import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  AttemptOutcomeSchema,
  MessageProtocolSchema,
  MessageStatusSchema,
  type AdminMessageDetail,
  type AdminMessageSummary,
  type DeliveryAttempt,
  type MessageProtocol,
  type MessageReceiptResponse,
  type MessageStatus,
} from "@shepherdjerred/mail/shared/contract.ts";

const RecipientsArraySchema = z.array(z.string());
const HeadersRecordSchema = z.record(z.string(), z.string());

export type MessageRow = {
  readonly id: string;
  readonly client_id: string;
  readonly protocol: string;
  readonly idempotency_key: string | null;
  readonly rfc_message_id: string;
  readonly mail_from: string;
  readonly rcpt_to_json: string;
  readonly from_header: string;
  readonly to_header: string;
  readonly subject: string;
  readonly tag: string | null;
  readonly plain_body: string | null;
  readonly html_body: string | null;
  readonly headers_json: string;
  readonly raw_mime: Uint8Array;
  readonly size_bytes: number;
  readonly status: string;
  readonly attempt_count: number;
  readonly next_attempt_at: string;
  readonly claimed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly sent_at: string | null;
  readonly failed_at: string | null;
  readonly last_smtp_code: number | null;
  readonly last_smtp_response: string | null;
  readonly last_error: string | null;
};

export type DeliveryAttemptRow = {
  readonly id: number;
  readonly message_id: string;
  readonly attempt_number: number;
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly outcome: string;
  readonly smtp_code: number | null;
  readonly smtp_response: string | null;
  readonly error: string | null;
};

const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('http', 'smtp')),
  idempotency_key TEXT,
  rfc_message_id TEXT NOT NULL,
  mail_from TEXT NOT NULL,
  rcpt_to_json TEXT NOT NULL,
  from_header TEXT NOT NULL,
  to_header TEXT NOT NULL,
  subject TEXT NOT NULL,
  tag TEXT,
  plain_body TEXT,
  html_body TEXT,
  headers_json TEXT NOT NULL,
  raw_mime BLOB NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'retrying', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT,
  last_smtp_code INTEGER,
  last_smtp_response TEXT,
  last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_idempotency
  ON messages(client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_status_next_attempt
  ON messages(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_messages_client_created
  ON messages(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_created
  ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'transient_error', 'permanent_error')),
  smtp_code INTEGER,
  smtp_response TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_message_attempt
  ON delivery_attempts(message_id, attempt_number);
`;

export function initializeMailSchema(db: Database, databasePath: string): void {
  db.run("PRAGMA foreign_keys = ON;");
  db.run("PRAGMA busy_timeout = 5000;");
  if (databasePath !== ":memory:") {
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");
  }
  db.run(TABLES_DDL);
}

export function parseRecipientsJson(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  return RecipientsArraySchema.parse(parsed);
}

export function parseHeadersJson(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw);
  return HeadersRecordSchema.parse(parsed);
}

export function parseMessageProtocol(raw: string): MessageProtocol {
  return MessageProtocolSchema.parse(raw);
}

export function parseMessageStatus(raw: string): MessageStatus {
  return MessageStatusSchema.parse(raw);
}

export function mapMessageSummary(row: MessageRow): AdminMessageSummary {
  return {
    id: row.id,
    clientId: row.client_id,
    protocol: parseMessageProtocol(row.protocol),
    rfcMessageId: row.rfc_message_id,
    mailFrom: row.mail_from,
    recipients: parseRecipientsJson(row.rcpt_to_json),
    fromHeader: row.from_header,
    toHeader: row.to_header,
    subject: row.subject,
    tag: row.tag,
    sizeBytes: row.size_bytes,
    status: parseMessageStatus(row.status),
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    lastSmtpCode: row.last_smtp_code,
    lastSmtpResponse: row.last_smtp_response,
    lastError: row.last_error,
  };
}

export function mapDeliveryAttempt(row: DeliveryAttemptRow): DeliveryAttempt {
  return {
    id: row.id,
    attemptNumber: row.attempt_number,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    outcome: AttemptOutcomeSchema.parse(row.outcome),
    smtpCode: row.smtp_code,
    smtpResponse: row.smtp_response,
    error: row.error,
  };
}

export function mapMessageDetail(
  row: MessageRow,
  attemptRows: readonly DeliveryAttemptRow[],
): AdminMessageDetail {
  return {
    ...mapMessageSummary(row),
    idempotencyKey: row.idempotency_key,
    plainBody: row.plain_body,
    htmlBody: row.html_body,
    headers: parseHeadersJson(row.headers_json),
    attempts: attemptRows.map((attempt) => mapDeliveryAttempt(attempt)),
  };
}

export function mapMessageReceipt(row: MessageRow): MessageReceiptResponse {
  return {
    id: row.id,
    rfcMessageId: row.rfc_message_id,
    status: parseMessageStatus(row.status),
    recipients: parseRecipientsJson(row.rcpt_to_json),
    tag: row.tag,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    lastSmtpCode: row.last_smtp_code,
    error: row.last_error,
  };
}
