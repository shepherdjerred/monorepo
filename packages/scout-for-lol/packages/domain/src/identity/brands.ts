import { z } from "zod";
import { PlatformRouteSchema } from "#src/identity/routes.ts";

/**
 * A Riot MatchV5 match id: the platform route the game was played on, an
 * underscore, and Riot's numeric game id (`NA1_5312279829`).
 *
 * The platform alternation is built from {@link PlatformRouteSchema} so the
 * enum stays the single source of truth: adding a platform route extends this
 * regex without a second list to forget.
 */
export type RiotMatchId = z.infer<typeof RiotMatchIdSchema>;
export const RiotMatchIdSchema = z
  .string()
  .regex(
    new RegExp(
      String.raw`^(?:${PlatformRouteSchema.options.join("|")})_\d+$`,
      "u",
    ),
  )
  .brand<"RiotMatchId">();

export type DiscordMessageId = z.infer<typeof DiscordMessageIdSchema>;
export const DiscordMessageIdSchema = z
  .string()
  .min(17)
  .max(20)
  .regex(/^\d+$/)
  .brand<"DiscordMessageId">();

export type WorkflowRunId = z.infer<typeof WorkflowRunIdSchema>;
export const WorkflowRunIdSchema = z.string().min(1).brand<"WorkflowRunId">();

export type RecoveryBatchId = z.infer<typeof RecoveryBatchIdSchema>;
export const RecoveryBatchIdSchema = z
  .string()
  .min(1)
  .brand<"RecoveryBatchId">();

export type NotificationIntentKey = z.infer<typeof NotificationIntentKeySchema>;
export const NotificationIntentKeySchema = z
  .string()
  .min(1)
  .brand<"NotificationIntentKey">();

/** An S3 object key. 1024 bytes is S3's hard key-length limit. */
export type S3ObjectKey = z.infer<typeof S3ObjectKeySchema>;
export const S3ObjectKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .brand<"S3ObjectKey">();

/** A SHA-256 digest in its canonical form: 64 lowercase hex characters. */
export type Sha256Digest = z.infer<typeof Sha256DigestSchema>;
export const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<"Sha256Digest">();

/** An ISO 8601 instant with an explicit UTC or numeric offset. */
export type IsoInstant = z.infer<typeof IsoInstantSchema>;
export const IsoInstantSchema = z.iso
  .datetime({ offset: true })
  .brand<"IsoInstant">();

export type DurationSeconds = z.infer<typeof DurationSecondsSchema>;
export const DurationSecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"DurationSeconds">();
