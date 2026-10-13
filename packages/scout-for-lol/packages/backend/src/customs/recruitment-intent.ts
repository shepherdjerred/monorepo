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
  await mintProductAnnouncement(db, {
    announcementId: `customs-recruitment:${nightId}:${night.recruitmentGeneration.toString()}`,
    guildId: snapshot.guildId,
    target: { kind: "channel", channelId: snapshot.launchChannelId },
    message: customRecruitmentMessage(snapshot),
    effect: {
      kind: "customs-recruitment",
      nightId,
      generation: night.recruitmentGeneration,
    },
    occurredAt: now,
    freshnessDeadline: night.expiresAt,
  });
}
