import { z } from "zod";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";

/**
 * Row codec for ScoutOperatorAuditEvent.
 *
 * Append-only: there is no update mapper on purpose. The detail column is
 * arbitrary JSON — it is parsed so a stored event is at least well-formed
 * JSON, and otherwise left to the reader. Ids are bigints because the table
 * only ever grows.
 */

export type ScoutOperatorAuditEventRecord = z.infer<
  typeof ScoutOperatorAuditEventRecordSchema
>;
export const ScoutOperatorAuditEventRecordSchema = z.strictObject({
  id: z.bigint().positive(),
  actorDiscordId: DiscordAccountIdSchema,
  action: z.string().min(1),
  subjectKind: z.string().min(1),
  subjectId: z.string().min(1),
  detail: z.unknown(),
  idempotencyKey: z.string().min(1).nullable(),
  createdAt: IsoInstantSchema,
});

const RawAuditEventRowSchema = z.object({
  id: z.bigint(),
  actorDiscordId: z.string(),
  action: z.string(),
  subjectKind: z.string(),
  subjectId: z.string(),
  detail: z.string(),
  idempotencyKey: z.string().nullable(),
  createdAt: z.date(),
});

export function scoutOperatorAuditEventRowToRecord(
  row: unknown,
): ScoutOperatorAuditEventRecord {
  const raw = RawAuditEventRowSchema.parse(row);
  const detail: unknown = JSON.parse(raw.detail);
  return ScoutOperatorAuditEventRecordSchema.parse({
    id: raw.id,
    actorDiscordId: raw.actorDiscordId,
    action: raw.action,
    subjectKind: raw.subjectKind,
    subjectId: raw.subjectId,
    detail,
    idempotencyKey: raw.idempotencyKey,
    createdAt: raw.createdAt.toISOString(),
  });
}
