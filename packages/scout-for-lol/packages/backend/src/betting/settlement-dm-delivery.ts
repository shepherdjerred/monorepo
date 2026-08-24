import * as Sentry from "@sentry/bun";
import type { Client } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { bettingAnchor, subjectFraming } from "#src/betting/components.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import {
  buildSettlementDmMessages,
  type TeamRecipient,
} from "#src/betting/settlement-dm.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPosition } from "#src/betting/sweep.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { sendDM, type DmStatus } from "#src/discord/utils/dm.ts";
import { createLogger } from "#src/logger.ts";
import { bettingSettlementDmsTotal } from "#src/metrics/betting.ts";

const logger = createLogger("betting-settlement-dm");

export type SettlementDmDeliveryDependencies = {
  client: Client;
  isPolicyEnabled: typeof isPolicyEnabled;
  sendDm: typeof sendDM;
  observeBucksDelivery: typeof observeBucksDelivery;
};

const defaultSettlementDmDeliveryDependencies: SettlementDmDeliveryDependencies =
  {
    client,
    isPolicyEnabled,
    sendDm: sendDM,
    observeBucksDelivery,
  };

async function playerRecipientsForRoster(input: {
  roster: readonly BucksPoolParticipant[];
  serverId: DiscordGuildId;
  prismaClient: ExtendedPrismaClient;
}): Promise<TeamRecipient[]> {
  const trackedParticipants = input.roster.flatMap((participant) => {
    if (participant.puuid === null || participant.trackedAlias === undefined) {
      return [];
    }
    return [{ puuid: participant.puuid, teamId: participant.teamId }];
  });
  if (trackedParticipants.length === 0) {
    return [];
  }
  const accounts = await input.prismaClient.account.findMany({
    where: {
      serverId: input.serverId,
      puuid: {
        in: trackedParticipants.map((participant) => participant.puuid),
      },
    },
    include: { player: { select: { discordId: true } } },
  });
  const discordIdByPuuid = new Map<string, string>();
  for (const account of accounts) {
    if (account.player.discordId !== null) {
      discordIdByPuuid.set(account.puuid, account.player.discordId);
    }
  }
  const recipientByTeam = new Map<string, TeamRecipient>();
  for (const participant of trackedParticipants) {
    const discordId = discordIdByPuuid.get(participant.puuid);
    if (discordId !== undefined) {
      recipientByTeam.set(`${discordId}:${participant.teamId.toString()}`, {
        discordId,
        teamId: participant.teamId,
      });
    }
  }
  return [...recipientByTeam.values()];
}

/**
 * DM delivery is deliberately outside public-announcement references: a
 * missing or unwritable channel cannot withhold a bettor's private result.
 */
export async function deliverSettlementDms(
  input: {
    summary: SettlementSummary;
    includeOutcome: boolean;
    parlay: ParlaySettlementSummary | undefined;
    unmatchedPositions: readonly ClosedPosition[];
    roster: readonly BucksPoolParticipant[];
    prismaClient?: ExtendedPrismaClient;
  },
  dependencies: SettlementDmDeliveryDependencies = defaultSettlementDmDeliveryDependencies,
): Promise<void> {
  const prismaClient = input.prismaClient ?? prisma;
  const guildId = DiscordGuildIdSchema.parse(input.summary.serverId);
  const receiptsEnabled = await dependencies.isPolicyEnabled(
    "betting_settlement_dm_enabled",
    { server: guildId },
  );
  if (!receiptsEnabled) {
    return;
  }
  const playerBetOutcomesEnabled = await dependencies.isPolicyEnabled(
    "betting_player_bet_outcome_dm_enabled",
    { server: guildId },
  );
  const playerRecipients = playerBetOutcomesEnabled
    ? await playerRecipientsForRoster({
        roster: input.roster,
        serverId: guildId,
        prismaClient,
      })
    : [];
  const anchor = bettingAnchor(input.roster);
  const messages = buildSettlementDmMessages({
    summary: input.summary,
    includeOutcome: input.includeOutcome,
    parlay: input.parlay,
    unmatchedPositions: input.unmatchedPositions,
    framing: anchor === undefined ? undefined : subjectFraming(anchor),
    receiptsEnabled,
    playerBetOutcomesEnabled,
    playerRecipients,
  });
  for (const message of messages) {
    let status: DmStatus | undefined;
    try {
      await dependencies.observeBucksDelivery(
        {
          surface: "settlement",
          operation: "send",
          matchId: input.summary.matchId,
          serverId: guildId,
        },
        async () => {
          status = await dependencies.sendDm({
            client: dependencies.client,
            userId: DiscordAccountIdSchema.parse(message.recipientId),
            message: message.content,
            kind: message.kind,
            guildId,
            prisma: prismaClient,
            suppressMentions: true,
          });
          if (status !== "sent") {
            throw new Error(`Settlement DM delivery returned ${status}.`);
          }
          return status;
        },
      );
      bettingSettlementDmsTotal.inc({
        recipient:
          message.kind === "betting_settlement_receipt" ? "bettor" : "player",
        result: "sent",
      });
    } catch (error) {
      // `sendDM` handles expected Discord failures, but an unexpected caller
      // failure must still leave every remaining recipient eligible to run.
      bettingSettlementDmsTotal.inc({
        recipient:
          message.kind === "betting_settlement_receipt" ? "bettor" : "player",
        result: status ?? "failed",
      });
      logger.error(
        `❌ Could not deliver Bryan Bucks DM for ${input.summary.matchId} to ${message.recipientId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-settlement-dm",
          matchId: input.summary.matchId,
        },
      });
    }
  }
}
