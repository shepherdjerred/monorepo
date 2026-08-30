import { EmbedBuilder } from "discord.js";
import { z } from "zod";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { client as discordClient } from "#src/discord/client.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";

const DiscordApiErrorSchema = z.object({ code: z.number() });

function isUnknownMessage(error: unknown): boolean {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === 10_008;
}

export function customRecruitmentMessage(snapshot: CustomNightSnapshot): {
  embeds: [EmbedBuilder];
} {
  const counts = snapshot.recruitmentCounts;
  const ended = snapshot.state === "ENDED";
  const needed = `${counts.remaining.toString()} more player${counts.remaining === 1 ? "" : "s"} needed.`;
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Scout Customs")
        .setDescription(
          ended
            ? "This custom-game night has ended."
            : `Open the Scout Customs Activity in this channel to join. ${needed}`,
        )
        .addFields(
          { name: "Ready", value: counts.ready.toString(), inline: true },
          { name: "Maybe", value: counts.maybe.toString(), inline: true },
          { name: "Away", value: counts.away.toString(), inline: true },
          { name: "Held", value: counts.held.toString(), inline: true },
        )
        .setFooter({
          text: "Joining records consent to private custom-game stats for this server. Scout does not create rankings or skill ratings.",
        })
        .setColor(ended ? 0x6b_72_80 : 0x58_65_f2),
    ],
  };
}

async function recruitmentChannel(channelId: string) {
  const channel = await discordClient.channels.fetch(channelId);
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
  const snapshot = await buildCustomNightSnapshot(
    prisma,
    nightId,
    "scout:discord",
  );
  if (snapshot === undefined) {
    throw new Error("Custom night does not exist");
  }
  if (snapshot.recruitmentMessageId === null) {
    return createRecruitmentMessage(prisma, snapshot);
  }
  const channel = await recruitmentChannel(snapshot.launchChannelId);
  try {
    const message = await channel.messages.fetch(snapshot.recruitmentMessageId);
    await message.edit(customRecruitmentMessage(snapshot));
  } catch (error) {
    if (!isUnknownMessage(error) || snapshot.state === "ENDED") throw error;
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
          data: { recruitmentMessageId: null },
        });
      },
    );
    return syncCustomRecruitmentMessage(prisma, snapshot.id);
  }
  return snapshot;
}
