import { EmbedBuilder, escapeMarkdown } from "discord.js";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";
import { parseProgressionJson } from "#src/progression/json.ts";
import { HallBreakOutboxPayloadSchema } from "#src/progression/hall/evaluate-match.ts";
import { hallRecordBreakDeliveries } from "#src/metrics/progression.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";

const HALL_EMBED_TITLE = "🏛️ Guild Hall of Fame record broken!";
const HALL_EMBED_SAFE_TOTAL_LENGTH = 5800;

function queueLabel(id: string): string {
  const family = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies.find(
    (candidate) => candidate.id === id,
  );
  if (family === undefined) throw new Error(`Unknown Hall queue family ${id}`);
  return family.label;
}

function recordLabel(id: string): string {
  const record = COMPETITIVE_PROGRESSION_CATALOG.hall.records.find(
    (candidate) => candidate.id === id,
  );
  if (record === undefined) throw new Error(`Unknown Hall record ${id}`);
  return record.label;
}

function truncateToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, Math.max(0, maxLength));
  return `${text.slice(0, maxLength - 3)}...`;
}

export function hallBreakEmbed(
  payloadJson: string,
  matchId: string,
): EmbedBuilder {
  const records = parseProgressionJson(
    payloadJson,
    HallBreakOutboxPayloadSchema,
  );
  const description = `Match ${escapeMarkdown(matchId)} set new guild records.`;
  const rawFields = records.map((record) => ({
    name: `${queueLabel(record.queueFamilyId)} · ${recordLabel(record.recordId)}`,
    prefix: `${record.value.toLocaleString("en-US")} — `,
    holders: record.holders
      .map((holder) => escapeMarkdown(holder.playerAlias))
      .join(", "),
  }));
  const fixedLength = rawFields.reduce(
    (total, field) => total + field.name.length + field.prefix.length,
    HALL_EMBED_TITLE.length + description.length,
  );
  let remainingHolderLength = Math.max(
    0,
    HALL_EMBED_SAFE_TOTAL_LENGTH - fixedLength,
  );
  const embed = new EmbedBuilder()
    .setTitle(HALL_EMBED_TITLE)
    .setDescription(description)
    .setColor(0xf5_ba_42);
  for (const [index, field] of rawFields.entries()) {
    const remainingFields = rawFields.length - index;
    const fairShare = Math.floor(remainingHolderLength / remainingFields);
    const names = truncateToLength(
      field.holders,
      Math.min(1024 - field.prefix.length, fairShare),
    );
    remainingHolderLength -= names.length;
    embed.addFields({
      name: field.name,
      value: `${field.prefix}${names}`,
      inline: false,
    });
  }
  return embed;
}

function discordNonce(outboxId: string): string {
  return `hf:${Bun.hash(outboxId).toString(36)}`;
}

export async function deliverHallRecordBreakOutbox(): Promise<void> {
  const activeRows = await prisma.hallRecordBreakOutbox.findMany({
    where: { deliveryStatus: { in: ["pending", "sending"] } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const failedRows = await prisma.hallRecordBreakOutbox.findMany({
    where: { deliveryStatus: "failed" },
    orderBy: { updatedAt: "asc" },
    take: 50 - activeRows.length,
  });
  const rows = [...activeRows, ...failedRows];
  const deliveryErrors: unknown[] = [];
  for (const row of rows) {
    const guildId = DiscordGuildIdSchema.parse(row.guildId);
    if (!(await isPolicyEnabled("hall_of_fame_enabled", { server: guildId }))) {
      await prisma.hallRecordBreakOutbox.update({
        where: { id: row.id },
        data: {
          deliveryStatus: "suppressed",
          lastError: "Hall notifications were disabled before delivery",
        },
      });
      continue;
    }
    const effectKey = `hall-record-break:${row.id}`;
    const claim = await claimScoutEffect({
      key: effectKey,
      kind: "hall-record-break-discord",
    });
    if (claim === "completed") {
      await prisma.hallRecordBreakOutbox.update({
        where: { id: row.id },
        data: { deliveryStatus: "sent", sentAt: row.sentAt ?? new Date() },
      });
      hallRecordBreakDeliveries.inc({ status: "deduplicated" });
      continue;
    }
    try {
      await prisma.hallRecordBreakOutbox.update({
        where: { id: row.id },
        data: {
          deliveryStatus: "sending",
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });
      await sendChannelMessage(
        {
          embeds: [hallBreakEmbed(row.payloadJson, row.matchId)],
          allowedMentions: { parse: [] },
          nonce: discordNonce(row.id),
          enforceNonce: true,
        },
        DiscordChannelIdSchema.parse(row.channelId),
        guildId,
      );
      await completeScoutEffect(effectKey);
      await prisma.hallRecordBreakOutbox.update({
        where: { id: row.id },
        data: { deliveryStatus: "sent", sentAt: new Date(), lastError: null },
      });
      hallRecordBreakDeliveries.inc({ status: "sent" });
    } catch (error) {
      await recordScoutEffectFailure(effectKey, error);
      await prisma.hallRecordBreakOutbox.update({
        where: { id: row.id },
        data: {
          deliveryStatus: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      hallRecordBreakDeliveries.inc({ status: "failed" });
      deliveryErrors.push(error);
    }
  }
  if (deliveryErrors.length > 0) {
    throw new AggregateError(
      deliveryErrors,
      `${deliveryErrors.length.toString()} Hall record-break delivery attempt(s) failed`,
    );
  }
}
