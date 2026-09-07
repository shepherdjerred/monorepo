import { z } from "zod";
import type { Db } from "#src/database/index.ts";
import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  scoutOperatorAuditEventRowToRecord,
  type ScoutOperatorAuditEventRecord,
} from "#src/database/durable/audit-event-row.ts";

/**
 * Repository for ScoutOperatorAuditEvent. Append-only by design: there is no
 * update or delete operation, and none should ever be added.
 */

export type OperatorAuditEventInput = {
  actorDiscordId: DiscordAccountId;
  action: string;
  subjectKind: string;
  subjectId: string;
  /** Arbitrary JSON-serializable detail; rejected loudly when it is not. */
  detail: unknown;
  /**
   * Optional replay key. A retried writer (e.g. a Temporal activity) passing
   * the same key gets the original event back instead of appending a second
   * one; omit it for events with no retry story.
   */
  idempotencyKey?: string;
};

const JsonDetailSchema = z.json();

export async function appendAuditEvent(
  db: Db,
  input: OperatorAuditEventInput,
): Promise<ScoutOperatorAuditEventRecord> {
  const detail = JsonDetailSchema.parse(input.detail);
  const data = {
    actorDiscordId: input.actorDiscordId,
    action: input.action,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    detail: JSON.stringify(detail),
    idempotencyKey: input.idempotencyKey ?? null,
  };
  if (input.idempotencyKey === undefined) {
    const created = await db.scoutOperatorAuditEvent.create({ data });
    return scoutOperatorAuditEventRowToRecord(created);
  }
  const created = await db.scoutOperatorAuditEvent.createManyAndReturn({
    data: [data],
    skipDuplicates: true,
  });
  const inserted = created[0];
  if (inserted !== undefined) {
    return scoutOperatorAuditEventRowToRecord(inserted);
  }
  const existing = await db.scoutOperatorAuditEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing === null) {
    throw new Error(
      `Audit event with idempotency key ${input.idempotencyKey} vanished between a duplicate insert and its read-back`,
    );
  }
  return scoutOperatorAuditEventRowToRecord(existing);
}

export async function listAuditEvents(
  db: Db,
  args: { subjectKind: string; subjectId: string },
): Promise<ScoutOperatorAuditEventRecord[]> {
  const rows = await db.scoutOperatorAuditEvent.findMany({
    where: { subjectKind: args.subjectKind, subjectId: args.subjectId },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => scoutOperatorAuditEventRowToRecord(row));
}
