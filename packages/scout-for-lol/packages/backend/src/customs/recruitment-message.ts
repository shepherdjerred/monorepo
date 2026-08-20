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
const RecruitmentCleanupPayloadSchema = z.object({
  messageId: z.string(),
  channelId: z.string(),
  replacedMessageId: z.string().nullable(),
});

function isUnknownDiscordMessage(error: unknown): boolean {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === 10_008;
}

function isUnknownDiscordChannel(error: unknown): boolean {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === 10_003;
}

async function cleanupPendingRecruitmentMessages(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
}): Promise<void> {
  const pending = await params.prisma.customAuditEvent.findMany({
    where: {
      nightId: params.nightId,
      action: "RECRUITMENT_MESSAGE_CLEANUP_PENDING",
    },
    orderBy: { createdAt: "asc" },
  });
  for (const event of pending) {
    const payload = RecruitmentCleanupPayloadSchema.parse(
      JSON.parse(event.payload),
    );
    let channel;
    try {
      channel = await customsDiscordClient.channels.fetch(payload.channelId);
    } catch (error) {
      if (!isUnknownDiscordChannel(error)) throw error;
      channel = null;
    }
    if (channel === null) {
      await params.prisma.customAuditEvent.update({
        where: { id: event.id },
        data: {
          action: "RECRUITMENT_MESSAGE_CLEANED",
          payload: JSON.stringify({
            ...payload,
            cleanedAt: new Date().toISOString(),
          }),
        },
      });
      continue;
    }
    if (!channel.isTextBased() || channel.isDMBased())
      throw new Error(
        "Recruitment cleanup channel is not a guild text channel",
      );
    try {
      const message = await channel.messages.fetch(payload.messageId);
      await message.delete();
    } catch (error) {
      if (!isUnknownDiscordMessage(error)) throw error;
    }
    await params.prisma.customAuditEvent.update({
      where: { id: event.id },
      data: {
        action: "RECRUITMENT_MESSAGE_CLEANED",
        payload: JSON.stringify({
          ...payload,
          cleanedAt: new Date().toISOString(),
        }),
      },
    });
  }
}

async function syncLatestCustomRecruitmentMessage(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
}): Promise<CustomNightSnapshot> {
  const snapshot = await getCustomNight(params.prisma, params.nightId);
  if (snapshot === null)
    throw new Error("Custom night disappeared while syncing recruitment");
  await cleanupPendingRecruitmentMessages({
    prisma: params.prisma,
    nightId: params.nightId,
  });
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
  try {
    await message.delete();
  } catch (error) {
    if (isUnknownDiscordMessage(error)) return mutation.snapshot;
    await params.prisma.customAuditEvent.create({
      data: {
        nightId: snapshot.id,
        revision: mutation.snapshot.revision,
        actorId: "SCOUT",
        action: "RECRUITMENT_MESSAGE_CLEANUP_PENDING",
        payload: JSON.stringify({
          messageId: message.id,
          channelId: channel.id,
          replacedMessageId,
        }),
        source: "DISCORD",
      },
    });
    throw error;
  }
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
