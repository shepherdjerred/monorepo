import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";

export const DareNotificationCategorySchema = z.enum(["lifecycle", "progress"]);
export const DareNotificationKindSchema = z.enum([
  "funded",
  "accepted",
  "declined",
  "contributed",
  "activated",
  "cancelled",
  "expired",
  "voided",
  "achieved",
  "failed",
  "advanced",
  "regressed",
  "race_leader_changed",
  "new_best",
  "rank_changed",
  "sequence_changed",
  "streak_changed",
]);

export type DareNotificationEventInput = {
  dareId: number;
  revision: number;
  category: z.infer<typeof DareNotificationCategorySchema>;
  kind: z.infer<typeof DareNotificationKindSchema>;
  actorDiscordId?: string | undefined;
  matchId?: string | undefined;
  summary: string;
  deduplicationKey: string;
  occurredAt: Date;
};

export async function enqueueDareNotificationInTransaction(
  tx: Db,
  input: DareNotificationEventInput,
): Promise<void> {
  const eventInput = {
    ...input,
    category: DareNotificationCategorySchema.parse(input.category),
    kind: DareNotificationKindSchema.parse(input.kind),
  };
  const dare = await tx.bucksDareV2.findUniqueOrThrow({
    where: { id: input.dareId },
    select: {
      serverId: true,
      challengerDiscordId: true,
      targets: { select: { discordId: true } },
      contributions: { select: { discordId: true } },
    },
  });
  const recipientIds = [
    ...new Set([
      dare.challengerDiscordId,
      ...dare.targets.map((target) => target.discordId),
      ...dare.contributions.map((contribution) => contribution.discordId),
    ]),
  ].map((discordId) => DiscordAccountIdSchema.parse(discordId));
  await tx.bucksDareNotificationEvent.createMany({
    data: [
      {
        id: globalThis.crypto.randomUUID(),
        dareId: eventInput.dareId,
        revision: eventInput.revision,
        category: eventInput.category,
        kind: eventInput.kind,
        ...(eventInput.actorDiscordId === undefined
          ? {}
          : { actorDiscordId: eventInput.actorDiscordId }),
        ...(eventInput.matchId === undefined
          ? {}
          : { matchId: eventInput.matchId }),
        payload: JSON.stringify({
          serverId: dare.serverId,
          summary: eventInput.summary,
        }),
        deduplicationKey: eventInput.deduplicationKey,
        occurredAt: eventInput.occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  const event = await tx.bucksDareNotificationEvent.findUniqueOrThrow({
    where: { deduplicationKey: eventInput.deduplicationKey },
    select: { id: true },
  });
  await tx.bucksDareNotificationDelivery.createMany({
    data: recipientIds.map((discordId) => ({
      eventId: event.id,
      discordId,
    })),
    skipDuplicates: true,
  });
}
