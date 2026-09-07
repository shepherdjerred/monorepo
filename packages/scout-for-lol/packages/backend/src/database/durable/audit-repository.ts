import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  scoutOperatorAuditEventRowToRecord,
  type ScoutOperatorAuditEventRecord,
} from "#src/database/durable/audit-event-row.ts";

/**
 * Repository for ScoutOperatorAuditEvent. Append-only by design: there is no
 * update or delete operation, and none should ever be added.
 */

type AuditDb = Pick<ExtendedPrismaClient, "scoutOperatorAuditEvent">;

export type OperatorAuditEventInput = {
  actorDiscordId: DiscordAccountId;
  action: string;
  subjectKind: string;
  subjectId: string;
  /** Arbitrary JSON-serializable detail; rejected loudly when it is not. */
  detail: unknown;
};

const JsonDetailSchema = z.json();

export async function appendAuditEvent(
  db: AuditDb,
  input: OperatorAuditEventInput,
): Promise<ScoutOperatorAuditEventRecord> {
  const detail = JsonDetailSchema.parse(input.detail);
  const created = await db.scoutOperatorAuditEvent.create({
    data: {
      actorDiscordId: input.actorDiscordId,
      action: input.action,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      detail: JSON.stringify(detail),
    },
  });
  return scoutOperatorAuditEventRowToRecord(created);
}

export async function listAuditEvents(
  db: AuditDb,
  args: { subjectKind: string; subjectId: string },
): Promise<ScoutOperatorAuditEventRecord[]> {
  const rows = await db.scoutOperatorAuditEvent.findMany({
    where: { subjectKind: args.subjectKind, subjectId: args.subjectId },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => scoutOperatorAuditEventRowToRecord(row));
}
