import { z } from "zod";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";

/**
 * Row codec for ScoutOperatorAuditEvent.
 *
 * Append-only: there is no update mapper on purpose. The detail column is
 * arbitrary JSON — it is parsed so a stored event is at least well-formed
 * JSON, and otherwise left to the reader.
 */

export type ScoutOperatorAuditEventRecord = z.infer<
  typeof ScoutOperatorAuditEventRecordSchema
>;
export const ScoutOperatorAuditEventRecordSchema = z.strictObject({
  id: z.int().positive(),
  actorDiscordId: DiscordAccountIdSchema,
  action: z.string().min(1),
  subjectKind: z.string().min(1),
  subjectId: z.string().min(1),
  detail: z.unknown(),
  createdAt: IsoInstantSchema,
});

const RawAuditEventRowSchema = z.object({
  id: z.number().int(),
  actorDiscordId: z.string(),
  action: z.string(),
  subjectKind: z.string(),
  subjectId: z.string(),
  detail: z.string(),
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
    createdAt: raw.createdAt.toISOString(),
  });
}
