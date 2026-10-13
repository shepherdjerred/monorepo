import type { Db } from "#src/database/index.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { customRecruitmentMessage } from "#src/customs/recruitment-content.ts";
import { mintProductAnnouncement } from "#src/temporal/notification/product/announcement.ts";

/** Initial creation and a confirmed missing-message replacement use this in their transaction. */
export async function mintCustomRecruitment(
  db: Db,
  nightId: string,
  now: Date,
): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "CustomNight" WHERE "id" = ${nightId} FOR UPDATE`;
  const night = await db.customNight.findUniqueOrThrow({
    where: { id: nightId },
  });
  if (night.state === "ENDED" || night.recruitmentMessageId !== null) return;
  const snapshot = await buildCustomNightSnapshot(
    db,
    nightId,
    night.hostDiscordId,
    now,
  );
  if (snapshot === undefined)
    throw new Error("Custom night disappeared during recruitment preparation");
  const input = {
    announcementId: `customs-recruitment:${nightId}:${night.recruitmentGeneration.toString()}`,
    guildId: snapshot.guildId,
    target: { kind: "channel" as const, channelId: snapshot.launchChannelId },
    message: customRecruitmentMessage(snapshot),
    effect: {
      kind: "customs-recruitment" as const,
      nightId,
      generation: night.recruitmentGeneration,
    },
    occurredAt: now,
    freshnessDeadline: night.expiresAt,
  };
  if ((await mintProductAnnouncement(db, input)) !== "confirmed-unsent") return;
  const replacement = await db.customNight.update({
    where: { id: nightId },
    data: {
      recruitmentGeneration: { increment: 1 },
      revision: { increment: 1 },
    },
  });
  await db.customAuditEvent.create({
    data: {
      nightId,
      revision: replacement.revision,
      actorId: "scout:discord",
      action: "RECRUITMENT_REISSUED",
      source: "TEMPORAL",
      payload: JSON.stringify({
        previousAnnouncementId: input.announcementId,
        generation: replacement.recruitmentGeneration,
      }),
    },
  });
  await mintProductAnnouncement(db, {
    ...input,
    announcementId: `customs-recruitment:${nightId}:${replacement.recruitmentGeneration.toString()}`,
    effect: { ...input.effect, generation: replacement.recruitmentGeneration },
  });
}
