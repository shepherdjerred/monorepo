import { EmbedBuilder } from "discord.js";
import { z } from "zod";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { customsDiscordClient } from "#src/customs/discord-client.ts";
import {
  commitCustomMutation,
  getCustomNight,
} from "#src/customs/repository.ts";

function recruitmentEmbed(snapshot: CustomNightSnapshot): EmbedBuilder {
  const counts = snapshot.recruitmentCounts;
  return new EmbedBuilder()
    .setTitle("Scout Customs")
    .setDescription(
      snapshot.state === "ENDED"
        ? "This custom-game night has ended."
        : `Open **Customs** in this channel to join. ${counts.remaining.toString()} more player${counts.remaining === 1 ? "" : "s"} needed.`,
    )
    .addFields(
      { name: "Ready", value: counts.ready.toString(), inline: true },
      { name: "Maybe", value: counts.maybe.toString(), inline: true },
      { name: "Away", value: counts.away.toString(), inline: true },
      { name: "Held", value: counts.held.toString(), inline: true },
    )
    .setFooter({
      text: "Joining records consent to private custom-game stats for this server. No rankings or skill ratings are created.",
    })
    .setColor(snapshot.state === "ENDED" ? 0x6b_72_80 : 0x58_65_f2);
}

const recruitmentSyncQueue = new Map<string, Promise<undefined>>();
const DiscordApiErrorSchema = z.object({ code: z.number() });

function isUnknownDiscordMessage(error: unknown): boolean {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === 10_008;
}

async function syncLatestCustomRecruitmentMessage(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
}): Promise<CustomNightSnapshot> {
  const snapshot = await getCustomNight(params.prisma, params.nightId);
  if (snapshot === null)
    throw new Error("Custom night disappeared while syncing recruitment");
  const channel = await customsDiscordClient.channels.fetch(
    snapshot.launchChannelId,
  );
  if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error("Custom night launch channel is not a guild text channel");
  }
  if (snapshot.recruitmentMessageId !== null) {
    try {
      const message = await channel.messages.fetch(
        snapshot.recruitmentMessageId,
      );
      await message.edit({ embeds: [recruitmentEmbed(snapshot)] });
      return snapshot;
    } catch (error) {
      if (!isUnknownDiscordMessage(error)) throw error;
    }
  }
  const replacedMessageId = snapshot.recruitmentMessageId;
  const message = await channel.send({
    embeds: [recruitmentEmbed(snapshot)],
  });
  const mutation = await commitCustomMutation({
    prisma: params.prisma,
    nightId: snapshot.id,
    expectedRevision: snapshot.revision,
    actorDiscordId: "SCOUT",
    action:
      replacedMessageId === null
        ? "RECRUITMENT_MESSAGE_CREATED"
        : "RECRUITMENT_MESSAGE_RECREATED",
    payload: {
      messageId: message.id,
      channelId: channel.id,
      replacedMessageId,
    },
    update: (current) => ({ ...current, recruitmentMessageId: message.id }),
  });
  if (mutation.applied) return mutation.snapshot;
  await message.delete();
  return mutation.snapshot;
}

export async function syncCustomRecruitmentMessage(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
}): Promise<CustomNightSnapshot> {
  const previous = recruitmentSyncQueue.get(params.snapshot.id);
  const gate = Promise.withResolvers<undefined>();
  recruitmentSyncQueue.set(params.snapshot.id, gate.promise);
  if (previous !== undefined) await previous;
  try {
    return await syncLatestCustomRecruitmentMessage({
      prisma: params.prisma,
      nightId: params.snapshot.id,
    });
  } finally {
    gate.resolve(undefined);
    if (recruitmentSyncQueue.get(params.snapshot.id) === gate.promise)
      recruitmentSyncQueue.delete(params.snapshot.id);
  }
}
