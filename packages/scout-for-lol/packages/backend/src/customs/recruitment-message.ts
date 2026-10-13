import type { DiscordChannelId } from "@scout-for-lol/domain/identity/discord.ts";
import { z } from "zod";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";
import { customRecruitmentMessage } from "#src/customs/recruitment-content.ts";
import { mintCustomRecruitment } from "#src/customs/recruitment-intent.ts";
import {
  orchestrationMode,
  withOrchestrationProducer,
} from "#src/temporal/orchestration-cutover.ts";

const DiscordApiErrorSchema = z.object({ code: z.number() });

function isUnknownMessage(error: unknown): boolean {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === 10_008;
}

async function recruitmentChannel(channelId: DiscordChannelId) {
  const channel = await fetchChannelForDelivery(channelId);
  if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Custom night launch channel is not a guild text channel");
  }
  return channel;
}

async function createRecruitmentMessage(
  prisma: ExtendedPrismaClient,
  snapshot: CustomNightSnapshot,
): Promise<CustomNightSnapshot> {
  if (snapshot.state === "ENDED") return snapshot;
  const channel = await recruitmentChannel(snapshot.launchChannelId);
  const message = await channel.send(customRecruitmentMessage(snapshot));
  const now = new Date();
  try {
    await commitCustomMutation(
      prisma,
      {
        nightId: snapshot.id,
        expectedRevision: snapshot.revision,
        actorId: "scout:discord",
        action: "RECRUITMENT_MESSAGE_CREATED",
        payload: { channelId: channel.id, messageId: message.id },
        source: "DISCORD",
        now,
      },
      async (transaction) => {
        await transaction.customNight.update({
          where: { id: snapshot.id },
          data: { recruitmentMessageId: message.id },
        });
      },
    );
  } catch (error) {
    await message.delete();
    throw error;
  }
  const updated = await buildCustomNightSnapshot(
    prisma,
    snapshot.id,
    snapshot.hostDiscordId,
    now,
  );
  if (updated === undefined) {
    throw new Error("Custom night disappeared after recruitment delivery");
  }
  return updated;
}

export async function syncCustomRecruitmentMessage(
  prisma: ExtendedPrismaClient,
  nightId: string,
): Promise<CustomNightSnapshot> {
  return await withOrchestrationProducer(
    async () => await syncRecruitmentUnderLease(prisma, nightId),
    prisma,
  );
}

async function syncRecruitmentUnderLease(
  prisma: ExtendedPrismaClient,
  nightId: string,
): Promise<CustomNightSnapshot> {
  const snapshot = await buildCustomNightSnapshot(
    prisma,
    nightId,
    "scout:discord",
  );
  if (snapshot === undefined) {
    throw new Error("Custom night does not exist");
  }
  if (snapshot.recruitmentMessageId === null) {
    const mode = await orchestrationMode(prisma);
    if (mode === "paused") return snapshot;
    if (mode === "durable") {
      await prisma.$transaction(async (db) => {
        await db.$queryRaw`SELECT "id" FROM "CustomNight" WHERE "id" = ${nightId} FOR UPDATE`;
        await mintCustomRecruitment(db, nightId, new Date());
      });
      return snapshot;
    }
    return createRecruitmentMessage(prisma, snapshot);
  }
  const channel = await recruitmentChannel(snapshot.launchChannelId);
  try {
    const message = await channel.messages.fetch(snapshot.recruitmentMessageId);
    await message.edit(customRecruitmentMessage(snapshot));
  } catch (error) {
    if (!isUnknownMessage(error) || snapshot.state === "ENDED") throw error;
    const mode = await orchestrationMode(prisma);
    if (mode === "paused") return snapshot;
    await commitCustomMutation(
      prisma,
      {
        nightId: snapshot.id,
        expectedRevision: snapshot.revision,
        actorId: "scout:discord",
        action: "RECRUITMENT_MESSAGE_MISSING",
        payload: { messageId: snapshot.recruitmentMessageId },
        source: "DISCORD",
        now: new Date(),
      },
      async (transaction) => {
        await transaction.customNight.update({
          where: { id: snapshot.id },
          data: {
            recruitmentMessageId: null,
            recruitmentGeneration: { increment: 1 },
          },
        });
        if (mode === "durable")
          await mintCustomRecruitment(transaction, snapshot.id, new Date());
      },
    );
    return syncCustomRecruitmentMessage(prisma, snapshot.id);
  }
  return snapshot;
}
