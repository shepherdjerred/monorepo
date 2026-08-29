import * as Sentry from "@sentry/bun";
import type { Client } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  getChampionDisplayNameById,
  queueTypeToDisplayString,
  QueueTypeSchema,
  type BucksPoolParticipant,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { bettingAnchor, subjectFraming } from "#src/betting/components.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { formatInteger } from "#src/betting/display-format.ts";
import type { EarnedAward } from "#src/betting/earnings.ts";
import { voidReasonText } from "#src/betting/outcome-message.ts";
import {
  buildSettlementDmMessages,
  SETTLEMENT_DM_NOTIFICATION_HINT,
  type RecipientEarningLine,
  type SettlementDmMatchContext,
  type TeamRecipient,
} from "#src/betting/settlement-dm.ts";
import { shortTeamName } from "#src/betting/team.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPosition } from "#src/betting/sweep-types.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  getBucksNotificationPreferencesForUsers,
  markBucksSettlementDmHintShown,
} from "#src/betting/notification-preferences.ts";
import { client } from "#src/discord/client.ts";
import { sendDM, type DmStatus } from "#src/discord/utils/dm.ts";
import { createLogger } from "#src/logger.ts";
import { bettingSettlementDmsTotal } from "#src/metrics/betting.ts";

const logger = createLogger("betting-settlement-dm");

/**
 * How many delivered settlement DMs may pass between `/bb notifications`
 * hints. The first eligible DM always carries it; after that, one hint every
 * eighth delivery — enough to stay discoverable without becoming furniture.
 */
export const SETTLEMENT_DM_HINT_EVERY = 7;

class SettlementDmStatusError extends Error {
  readonly status: Exclude<DmStatus, "sent">;

  constructor(status: Exclude<DmStatus, "sent">) {
    super(`Settlement DM delivery returned ${status}.`);
    this.name = "SettlementDmStatusError";
    this.status = status;
  }
}

export type SettlementDmDeliveryDependencies = {
  client: Client;
  isPolicyEnabled: typeof isPolicyEnabled;
  getNotificationPreferencesForUsers: typeof getBucksNotificationPreferencesForUsers;
  markNotificationHintShown: typeof markBucksSettlementDmHintShown;
  countRecentSettlementDms: typeof countDeliveredSettlementDmsSince;
  sendDm: typeof sendDM;
  observeBucksDelivery: typeof observeBucksDelivery;
};

/** Delivered settlement DMs to one recipient since their last hint. */
async function countDeliveredSettlementDmsSince(
  input: {
    recipientId: string;
    serverId: DiscordGuildId;
    since: Date;
  },
  prismaClient: ExtendedPrismaClient,
): Promise<number> {
  return await prismaClient.dmAuditLog.count({
    where: {
      recipientId: input.recipientId,
      guildId: input.serverId,
      kind: {
        in: ["betting_settlement_receipt", "betting_player_bet_outcome"],
      },
      deliveryStatus: "sent",
      createdAt: { gt: input.since },
    },
  });
}

const defaultSettlementDmDeliveryDependencies: SettlementDmDeliveryDependencies =
  {
    client,
    isPolicyEnabled,
    getNotificationPreferencesForUsers: getBucksNotificationPreferencesForUsers,
    markNotificationHintShown: markBucksSettlementDmHintShown,
    countRecentSettlementDms: countDeliveredSettlementDmsSince,
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

/** "Ranked solo — jerred (Ahri), bryan (Lee Sin)" from the frozen roster. */
function buildGameLine(
  roster: readonly BucksPoolParticipant[],
  queueType: string | null,
): string | undefined {
  const queue = QueueTypeSchema.safeParse(queueType).data;
  const queueLabel =
    queue === undefined ? undefined : queueTypeToDisplayString(queue);
  const tracked = roster.flatMap((participant) =>
    participant.trackedAlias === undefined
      ? []
      : [
          `${participant.trackedAlias} (${getChampionDisplayNameById(participant.championId)})`,
        ],
  );
  if (queueLabel === undefined && tracked.length === 0) {
    return undefined;
  }
  const players = tracked.join(", ");
  if (queueLabel === undefined) {
    return players;
  }
  return players === "" ? queueLabel : `${queueLabel} — ${players}`;
}

/** "jerred's side (Blue) won." / "Voided — remake." from the settled summary. */
function buildResultLine(
  summary: SettlementSummary,
  roster: readonly BucksPoolParticipant[],
): string | undefined {
  if (summary.voidReason !== undefined) {
    return `Voided — ${voidReasonText(summary.voidReason)}.`;
  }
  if (summary.winningTeamId === undefined) {
    return undefined;
  }
  const winningTeamId = summary.winningTeamId;
  const winners = roster.flatMap((participant) =>
    participant.teamId === winningTeamId &&
    participant.trackedAlias !== undefined
      ? [participant.trackedAlias]
      : [],
  );
  const team =
    winningTeamId === 100 || winningTeamId === 200
      ? shortTeamName(winningTeamId)
      : undefined;
  if (winners.length > 0) {
    const suffix = team === undefined ? "" : ` (${team})`;
    return `${winners.join(", ")} won${suffix}.`;
  }
  return team === undefined ? undefined : `${team} won.`;
}

function buildEarningLines(
  earnings: readonly EarnedAward[],
  serverId: DiscordGuildId,
): RecipientEarningLine[] {
  return earnings.flatMap((award) =>
    award.serverId === serverId
      ? [
          {
            discordId: award.discordId,
            line: `🪙 +${formatInteger(award.total)} BB (${award.reasons.join(", ")})`,
          },
        ]
      : [],
  );
}

/**
 * Who is due the `/bb notifications` hint on this delivery.
 *
 * Derived from `DmAuditLog` rather than a counter (the repo's ledger rule):
 * a recipient who has never seen the hint gets it now; afterwards it repeats
 * once every `SETTLEMENT_DM_HINT_EVERY` *delivered* settlement DMs, counted
 * from rows newer than the recorded `settlementDmHintShownAt` stamp.
 */
async function resolveHintRecipients(input: {
  candidates: readonly string[];
  hintShownAtById: ReadonlyMap<string, Date | null>;
  serverId: DiscordGuildId;
  prismaClient: ExtendedPrismaClient;
  countRecentSettlementDms: typeof countDeliveredSettlementDmsSince;
}): Promise<Set<string>> {
  const due = new Set<string>();
  for (const discordId of input.candidates) {
    const shownAt = input.hintShownAtById.get(discordId) ?? null;
    if (shownAt === null) {
      due.add(discordId);
      continue;
    }
    const sentSince = await input.countRecentSettlementDms(
      { recipientId: discordId, serverId: input.serverId, since: shownAt },
      input.prismaClient,
    );
    if (sentSince >= SETTLEMENT_DM_HINT_EVERY) {
      due.add(discordId);
    }
  }
  return due;
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
    /** The pool's stored queue, for the DM's game line. */
    queueType?: string | null;
    /** This game's earnings, folded into each earner's own DM. */
    earnings?: readonly EarnedAward[];
    /** Scout's revealed estimate + verdict, exactly as the channel shows it. */
    predictionLine?: string | undefined;
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
  const preferenceRecipientIds = [
    ...input.summary.bets.map((bet) => bet.discordId),
    ...(input.parlay?.bets.map((bet) => bet.discordId) ?? []),
    ...input.unmatchedPositions.map((position) => position.discordId),
    ...playerRecipients.map((recipient) => recipient.discordId),
  ];
  const preferences = await dependencies.getNotificationPreferencesForUsers(
    { serverId: guildId, discordIds: [...new Set(preferenceRecipientIds)] },
    prismaClient,
  );
  const preferenceFor = (discordId: string) =>
    preferences.get(discordId) ?? {
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
      settlementDmHintShownAt: null,
    };
  const receiptRecipientIds = new Set(
    preferenceRecipientIds.filter(
      (discordId) => preferenceFor(discordId).ownBetSettlementDms,
    ),
  );
  const enabledPlayerRecipients = playerRecipients.filter(
    (recipient) => preferenceFor(recipient.discordId).betsOnPlayerSettlementDms,
  );
  const hintCandidates = [
    ...new Set([
      ...receiptRecipientIds,
      ...enabledPlayerRecipients.map((recipient) => recipient.discordId),
    ]),
  ];
  const hintRecipientIds = await resolveHintRecipients({
    candidates: hintCandidates,
    hintShownAtById: new Map(
      hintCandidates.map((discordId) => [
        discordId,
        preferenceFor(discordId).settlementDmHintShownAt,
      ]),
    ),
    serverId: guildId,
    prismaClient,
    countRecentSettlementDms: dependencies.countRecentSettlementDms,
  });
  const anchor = bettingAnchor(input.roster);
  const subjectAliasByPuuid = new Map(
    input.roster.flatMap((participant) =>
      participant.puuid !== null && participant.trackedAlias !== undefined
        ? [[participant.puuid, participant.trackedAlias] as const]
        : [],
    ),
  );
  const matchContext: SettlementDmMatchContext = {
    gameLine: buildGameLine(input.roster, input.queueType ?? null),
    resultLine: buildResultLine(input.summary, input.roster),
    predictionLine: input.predictionLine,
  };
  const messages = buildSettlementDmMessages({
    summary: input.summary,
    includeOutcome: input.includeOutcome,
    parlay: input.parlay,
    unmatchedPositions: input.unmatchedPositions,
    framing: anchor === undefined ? undefined : subjectFraming(anchor),
    receiptsEnabled,
    receiptRecipientIds,
    playerBetOutcomesEnabled,
    playerRecipients: enabledPlayerRecipients,
    hintRecipientIds,
    matchContext,
    subjectAliasByPuuid,
    earningLines: buildEarningLines(input.earnings ?? [], guildId),
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
            // The plain rendering is the audit-log record; the embed is what
            // the recipient sees, with the hint as content above it.
            message: message.content,
            embeds: [message.embed],
            ...(message.showHint
              ? { contentWithEmbeds: SETTLEMENT_DM_NOTIFICATION_HINT }
              : {}),
            kind: message.kind,
            guildId,
            prisma: prismaClient,
            suppressMentions: true,
          });
          if (status !== "sent") {
            throw new SettlementDmStatusError(status);
          }
          return status;
        },
      );
      bettingSettlementDmsTotal.inc({
        recipient:
          message.kind === "betting_settlement_receipt" ? "bettor" : "player",
        result: "sent",
      });
      if (hintRecipientIds.has(message.recipientId)) {
        try {
          await dependencies.markNotificationHintShown(
            { serverId: guildId, discordId: message.recipientId },
            prismaClient,
          );
        } catch (error) {
          logger.error(
            `❌ Could not record Bryan Bucks notification hint for ${message.recipientId}:`,
            error,
          );
          Sentry.captureException(error, {
            tags: {
              source: "betting-settlement-dm-hint",
              matchId: input.summary.matchId,
            },
          });
        }
      }
    } catch (error) {
      // `sendDM` handles expected Discord failures. The observer still needs
      // a rejection to count those statuses, but they are not Sentry errors.
      bettingSettlementDmsTotal.inc({
        recipient:
          message.kind === "betting_settlement_receipt" ? "bettor" : "player",
        result: status ?? "failed",
      });
      if (error instanceof SettlementDmStatusError) {
        logger.info(
          `Bryan Bucks DM for ${input.summary.matchId} to ${message.recipientId} returned ${error.status}.`,
        );
      } else {
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
}
