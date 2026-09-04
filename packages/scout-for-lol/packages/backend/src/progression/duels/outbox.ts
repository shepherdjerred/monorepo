import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { getDashboardUrl } from "#src/discord/commands/links.ts";
import { prisma } from "#src/database/index.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";
import { duelRolloutAllowed } from "#src/progression/duels/access.ts";
import { loadProgressionOutboxRows } from "#src/progression/outbox.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";

const DuelStatusPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("invited"),
    seriesId: z.uuid(),
    mentionDiscordIds: DiscordAccountIdSchema.array(),
  }),
  z.strictObject({
    kind: z.literal("overdue"),
    seriesId: z.uuid(),
    mentionDiscordIds: DiscordAccountIdSchema.array(),
  }),
  z.strictObject({
    kind: z.literal("code_ready"),
    seriesId: z.uuid(),
    gameNumber: z.number().int().positive(),
  }),
]);

function renderStatus(
  payload: z.infer<typeof DuelStatusPayloadSchema>,
  guildId: string,
) {
  const path = new URL(
    `duels/${guildId}/series/${payload.seriesId}`,
    getDashboardUrl(),
  ).toString();
  if (payload.kind === "code_ready") {
    return {
      content: "",
      embed: new EmbedBuilder()
        .setTitle("Duel lobby ready")
        .setDescription(
          `Game ${payload.gameNumber.toString()} is ready. Assigned players can reveal the code in the [Scout web app](${path}).`,
        )
        .setColor(0x57_f2_87),
      users: [],
    };
  }
  const mentions = payload.mentionDiscordIds.map((id) => `<@${id}>`).join(" ");
  return {
    content: mentions,
    embed: new EmbedBuilder()
      .setTitle(
        payload.kind === "overdue" ? "Duel series overdue" : "Duel challenge",
      )
      .setDescription(
        payload.kind === "overdue"
          ? `The match window expired without an automatic result. An organizer must choose replay, no-contest, or advancement with a reason in the [Scout web app](${path}).`
          : `A new duel needs participant acceptance in the [Scout web app](${path}).`,
      )
      .setFooter({ text: escapeMarkdown(payload.seriesId) })
      .setColor(payload.kind === "overdue" ? 0xed_42_45 : 0x58_65_f2),
    users: payload.mentionDiscordIds,
  };
}

export async function deliverDuelStatusOutbox(): Promise<void> {
  const rows = await loadProgressionOutboxRows(
    async (take) =>
      await prisma.duelStatusOutbox.findMany({
        where: { deliveryStatus: { in: ["pending", "sending"] } },
        orderBy: { createdAt: "asc" },
        take,
      }),
    async (take) =>
      await prisma.duelStatusOutbox.findMany({
        where: { deliveryStatus: "failed" },
        orderBy: { updatedAt: "asc" },
        take,
      }),
  );
  const deliveryErrors: unknown[] = [];
  for (const row of rows) {
    const guildId = DiscordGuildIdSchema.parse(row.guildId);
    if (
      !(await duelRolloutAllowed(prisma, guildId, configuration.environment))
    ) {
      await prisma.duelStatusOutbox.update({
        where: { id: row.id },
        data: {
          deliveryStatus: "suppressed",
          lastError: "Duel notifications were disabled before delivery",
        },
      });
      continue;
    }
    const effectKey = `duel-status:${row.dedupeKey}`;
    const claim = await claimScoutEffect({
      key: effectKey,
      kind: "duel-status-discord",
    });
    if (claim === "completed") {
      await prisma.duelStatusOutbox.update({
        where: { id: row.id },
        data: { deliveryStatus: "sent", sentAt: row.sentAt ?? new Date() },
      });
      continue;
    }
    try {
      await prisma.duelStatusOutbox.update({
        where: { id: row.id },
        data: {
          deliveryStatus: "sending",
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });
      const rendered = renderStatus(
        DuelStatusPayloadSchema.parse(JSON.parse(row.payloadJson)),
        guildId,
      );
      await sendChannelMessage(
        {
          content: rendered.content,
          embeds: [rendered.embed],
          allowedMentions: { parse: [], users: rendered.users },
          nonce: `duel:${Bun.hash(row.dedupeKey).toString(36)}`,
          enforceNonce: true,
        },
        DiscordChannelIdSchema.parse(row.channelId),
        guildId,
      );
      await completeScoutEffect(effectKey);
      await prisma.duelStatusOutbox.update({
        where: { id: row.id },
        data: { deliveryStatus: "sent", sentAt: new Date(), lastError: null },
      });
    } catch (error) {
      await recordScoutEffectFailure(effectKey, error);
      await prisma.duelStatusOutbox.update({
        where: { id: row.id },
        data: {
          deliveryStatus: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      deliveryErrors.push(error);
    }
  }
  if (deliveryErrors.length > 0) {
    throw new AggregateError(
      deliveryErrors,
      `${deliveryErrors.length.toString()} duel status delivery attempt(s) failed`,
    );
  }
}
