import { z } from "zod";
import type { MessageCreateOptions } from "discord.js";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  Sha256DigestSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import type { NotificationTarget } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutNotificationWorkflowId,
} from "@scout-for-lol/temporal";
import configuration from "#src/configuration.ts";
import type { Db } from "#src/database/index.ts";
import {
  getSubjectIntent,
  upsertSubjectIntent,
} from "#src/database/durable/intent-repository.ts";
import type { ProductNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { requestWorkflowStart } from "#src/database/durable/workflow-start-repository.ts";
import { NotificationMessageSnapshotSchema } from "#src/temporal/notification/notification-presentation.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/notification/announcement-codecs.ts";

export const FrozenAnnouncementArtifactSchema = z.strictObject({
  key: z.string().regex(/^product-announcements\/[0-9a-f]{64}$/),
  digest: Sha256DigestSchema,
  bytes: z
    .int()
    .positive()
    .max(8 * 1024 * 1024),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^/\\]+$/),
});
export type FrozenAnnouncementArtifact = z.infer<
  typeof FrozenAnnouncementArtifactSchema
>;

export const ProductAnnouncementEffectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("competition"),
    competitionId: z.int().positive(),
    phase: z.enum(["start", "scheduled", "end"]),
    occurredAt: IsoInstantSchema,
  }),
  z.strictObject({
    kind: z.literal("weekly-bucks"),
    publicationId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("customs-recruitment"),
    nightId: z.uuid(),
    generation: z.int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("outreach"),
    auditId: z.int().positive(),
    installedAt: IsoInstantSchema,
    ladderStage: z.int().min(1).max(3),
  }),
]);
export type ProductAnnouncementEffect = z.infer<
  typeof ProductAnnouncementEffectSchema
>;

const MessageJsonSchema = z
  .string()
  .max(256 * 1024)
  .superRefine((json, ctx) => {
    try {
      NotificationMessageSnapshotSchema.parse(JSON.parse(json));
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid frozen Discord message",
      });
    }
  });

export const productAnnouncementCodec = defineVersionedCodec({
  kind: "scout-product-announcement",
  version: 1,
  schema: z.strictObject({
    announcementId: z.string().min(1),
    guildId: DiscordGuildIdSchema,
    messageJson: MessageJsonSchema,
    artifacts: z.array(FrozenAnnouncementArtifactSchema).max(10),
    effect: ProductAnnouncementEffectSchema,
  }),
});
export type ProductAnnouncement = ReturnType<
  typeof productAnnouncementCodec.parse
>;

export function productAnnouncementOf(
  record: ProductNotificationIntentRecord,
): ProductAnnouncement {
  try {
    const announcement = productAnnouncementCodec.parse(
      record.intent.announcement,
    );
    if (announcement.announcementId !== record.announcementId)
      throw new Error("The frozen occurrence disagrees with its subject");
    return announcement;
  } catch (error) {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function productAnnouncementIntentKey(
  announcementId: string,
  target: NotificationTarget,
) {
  return NotificationIntentKeySchema.parse(
    `product-discord:${announcementId}:${target.kind}:${target.kind === "channel" ? target.channelId : target.accountId}`,
  );
}

/** Call inside the transaction which advances the product occurrence. */
export async function mintProductAnnouncement(
  db: Db,
  input: {
    announcementId: string;
    guildId: z.infer<typeof DiscordGuildIdSchema>;
    target: NotificationTarget;
    message: Pick<MessageCreateOptions, "content" | "embeds" | "components">;
    artifacts?: readonly FrozenAnnouncementArtifact[];
    effect: ProductAnnouncementEffect;
    occurredAt: Date;
    freshnessDeadline: Date;
  },
): Promise<"minted" | "existing" | "confirmed-unsent"> {
  const key = productAnnouncementIntentKey(input.announcementId, input.target);
  const existing = await getSubjectIntent(db, { intentKey: key });
  if (existing !== null) {
    if (!("announcementId" in existing))
      throw new Error(`Product occurrence ${key} has another subject`);
    const saved = productAnnouncementOf(existing);
    if (
      saved.guildId !== input.guildId ||
      !Bun.deepEquals(saved.effect, input.effect, true)
    )
      throw new Error(`Product occurrence ${key} has conflicting identity`);
    if (
      existing.intent.state.kind === "permission-denied" &&
      existing.intent.lastFailure?.classification === "terminal" &&
      existing.intent.lastFailure.reason === "permission-denied"
    )
      return "confirmed-unsent";
    // The first committed snapshot wins, even if standings changed on retry.
    return "existing";
  }
  const announcement = productAnnouncementCodec.serialize({
    announcementId: input.announcementId,
    guildId: input.guildId,
    messageJson: JSON.stringify({ version: 1, ...input.message }),
    artifacts: [...(input.artifacts ?? [])],
    effect: input.effect,
  });
  const createdAt = IsoInstantSchema.parse(input.occurredAt.toISOString());
  const created = await upsertSubjectIntent(db, {
    announcementId: input.announcementId,
    intent: {
      key,
      kind: "product-announcement",
      origin: { kind: "live" },
      target: input.target,
      createdAt,
      freshnessDeadline: IsoInstantSchema.parse(
        input.freshnessDeadline.toISOString(),
      ),
      attemptCount: 0,
      announcement,
      state: { kind: "pending" },
    },
  });
  if (created.outcome === "conflict")
    throw new Error(`Product occurrence ${key} raced with different facts`);
  if (created.outcome === "already-applied") return "existing";
  const stage = configuration.temporalNamespace;
  const requested = await requestWorkflowStart(db, {
    requestedWorkflowId: scoutNotificationWorkflowId(stage, key),
    workflowType: SCOUT_WORKFLOW_NAMES.notification,
    requestedBy: null,
    requestSource: `product-announcement:${input.effect.kind}`,
    requestedAt: createdAt,
    inputPayload: {
      kind: SCOUT_WORKFLOW_NAMES.notification,
      version: 1,
      data: { stage, intentKey: key },
    },
  });
  if (requested.outcome === "conflict")
    throw new Error(`Product occurrence ${key} has a conflicting start`);
  return "minted";
}
