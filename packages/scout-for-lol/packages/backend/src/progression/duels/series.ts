import type { PlayerIdSchema } from "@scout-for-lol/data";
import {
  DUEL_DISCLOSURE_VERSION,
  DiscordAccountIdSchema,
  DuelBestOfSchema,
  DuelRulesetV1Schema,
  DuelSeriesStatusSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type DuelBestOf,
  type DuelRulesetV1,
} from "@scout-for-lol/data";
import {
  scoutDuelSeriesWorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  duelCompetitorCreateData,
  parseDuelCompetitor,
  resolveDuelCompetitorSelection,
  type DuelCompetitorSelection,
} from "#src/progression/duels/competitors.ts";

const MIN_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 14 * 24;

type ResolvedCompetitor = Awaited<
  ReturnType<typeof resolveDuelCompetitorSelection>
>;

function validateWindowHours(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_WINDOW_HOURS ||
    value > MAX_WINDOW_HOURS
  ) {
    throw new Error("A duel match window must be between 24 hours and 14 days");
  }
  return value;
}

function competitorMatches(
  stored: {
    readonly kind: string;
    readonly teamName: string | null;
    readonly members: readonly { readonly accountId: number }[];
  },
  requested: ResolvedCompetitor,
): boolean {
  const storedAccounts = stored.members
    .map((member) => member.accountId)
    .toSorted((left, right) => left - right);
  const requestedAccounts = requested.accounts
    .map((account) => account.accountId)
    .toSorted((left, right) => left - right);
  return (
    stored.kind === requested.kind &&
    stored.teamName === requested.teamName &&
    storedAccounts.length === requestedAccounts.length &&
    storedAccounts.every(
      (accountId, index) => accountId === requestedAccounts[index],
    )
  );
}

export async function createDirectDuel(
  db: ExtendedPrismaClient,
  options: {
    readonly requestId: string;
    readonly guildId: DiscordGuildId;
    readonly organizerDiscordId: DiscordAccountId;
    readonly channelId: DiscordChannelId;
    readonly competitorKind: "player" | "pair";
    readonly first: DuelCompetitorSelection;
    readonly second: DuelCompetitorSelection;
    readonly bestOf: DuelBestOf;
    readonly ruleset: DuelRulesetV1;
    readonly matchWindowHours: number;
    readonly stage: ScoutStage;
  },
) {
  const [first, second] = await Promise.all([
    resolveDuelCompetitorSelection(
      db,
      options.guildId,
      options.competitorKind,
      options.first,
    ),
    resolveDuelCompetitorSelection(
      db,
      options.guildId,
      options.competitorKind,
      options.second,
    ),
  ]);
  const allPlayers = [...first.accounts, ...second.accounts].map(
    (account) => account.playerId,
  );
  if (new Set(allPlayers).size !== allPlayers.length) {
    throw new Error("A player cannot appear on both sides of a duel");
  }
  if (
    new Set(
      [...first.accounts, ...second.accounts].map((account) => account.region),
    ).size !== 1
  ) {
    throw new Error("Duel competitors must use accounts in one Riot region");
  }
  const ruleset = DuelRulesetV1Schema.parse(options.ruleset);
  const bestOf = DuelBestOfSchema.parse(options.bestOf);
  const matchWindowHours = validateWindowHours(options.matchWindowHours);
  const now = new Date();
  const deadlineAt = new Date(
    now.getTime() + matchWindowHours * 60 * 60 * 1000,
  );
  const seriesId = options.requestId;
  const workflowId = scoutDuelSeriesWorkflowId(options.stage, seriesId);
  const series = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-direct-duel'), hashtext(${seriesId}))`;
    const existing = await tx.duelSeries.findUnique({
      where: { id: seriesId },
      include: {
        competitorOne: { include: { members: true } },
        competitorTwo: { include: { members: true } },
      },
    });
    if (existing !== null) {
      if (
        existing.guildId !== options.guildId ||
        existing.organizerDiscordId !== options.organizerDiscordId ||
        existing.channelId !== options.channelId ||
        existing.bestOf !== bestOf ||
        existing.rulesetJson !== JSON.stringify(ruleset) ||
        !competitorMatches(existing.competitorOne, first) ||
        !competitorMatches(existing.competitorTwo, second)
      ) {
        throw new Error("The duel request key was reused with different input");
      }
      return existing;
    }
    const firstRow = await tx.duelCompetitor.create({
      data: duelCompetitorCreateData(options.guildId, first),
    });
    const secondRow = await tx.duelCompetitor.create({
      data: duelCompetitorCreateData(options.guildId, second),
    });
    const row = await tx.duelSeries.create({
      data: {
        id: seriesId,
        guildId: options.guildId,
        competitorOneId: firstRow.id,
        competitorTwoId: secondRow.id,
        bestOf,
        rulesetJson: JSON.stringify(ruleset),
        channelId: options.channelId,
        organizerDiscordId: options.organizerDiscordId,
        deadlineAt,
        workflowId,
        participants: {
          create: [...first.accounts, ...second.accounts].map((account) => ({
            playerId: account.playerId,
            competitorId: first.accounts.some(
              (candidate) => candidate.playerId === account.playerId,
            )
              ? firstRow.id
              : secondRow.id,
            discordId: DiscordAccountIdSchema.parse(account.discordId),
            disclosureVersion: DUEL_DISCLOSURE_VERSION,
          })),
        },
      },
    });
    await tx.duelStatusOutbox.create({
      data: {
        guildId: options.guildId,
        channelId: options.channelId,
        dedupeKey: `duel-invited:${row.id}`,
        payloadJson: JSON.stringify({
          kind: "invited",
          seriesId: row.id,
          mentionDiscordIds: [...first.accounts, ...second.accounts].map(
            (account) => account.discordId,
          ),
        }),
      },
    });
    return row;
  });
  return {
    seriesId: series.id,
    deadlineAt: series.deadlineAt ?? deadlineAt,
    workflowId: series.workflowId,
  };
}

export async function acceptDuelDisclosure(
  db: ExtendedPrismaClient,
  options: {
    readonly guildId: DiscordGuildId;
    readonly playerId: ReturnType<typeof PlayerIdSchema.parse>;
    readonly discordId: DiscordAccountId;
  },
) {
  const player = await db.player.findFirstOrThrow({
    where: {
      id: options.playerId,
      serverId: options.guildId,
      discordId: options.discordId,
    },
  });
  return await db.duelDisclosureAcceptance.upsert({
    where: {
      guildId_playerId_disclosureVersion: {
        guildId: options.guildId,
        playerId: player.id,
        disclosureVersion: DUEL_DISCLOSURE_VERSION,
      },
    },
    create: {
      guildId: options.guildId,
      playerId: player.id,
      discordId: options.discordId,
      disclosureVersion: DUEL_DISCLOSURE_VERSION,
      acceptedAt: new Date(),
    },
    update: {
      discordId: options.discordId,
      acceptedAt: new Date(),
    },
  });
}

async function currentParticipantDiscordIds(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  participants: readonly {
    readonly playerId: number;
    readonly discordId: string;
  }[],
): Promise<ReadonlyMap<number, string | null>> {
  const players = await db.player.findMany({
    where: {
      id: { in: participants.map((participant) => participant.playerId) },
      serverId: guildId,
    },
    select: { id: true, discordId: true },
  });
  return new Map(players.map((player) => [player.id, player.discordId]));
}

function effectiveParticipantDiscordId(
  current: ReadonlyMap<number, string | null>,
  participant: { readonly playerId: number; readonly discordId: string },
): string | null | undefined {
  return current.has(participant.playerId)
    ? current.get(participant.playerId)
    : participant.discordId;
}

async function participantSeries(
  db: ExtendedPrismaClient,
  seriesId: string,
  discordId: DiscordAccountId,
  guildId: DiscordGuildId,
) {
  const series = await db.duelSeries.findFirstOrThrow({
    where: { id: seriesId, guildId },
    include: { participants: true },
  });
  const currentDiscordIdByPlayer = await currentParticipantDiscordIds(
    db,
    guildId,
    series.participants,
  );
  const participants = series.participants.filter(
    (participant) =>
      effectiveParticipantDiscordId(currentDiscordIdByPlayer, participant) ===
      discordId,
  );
  if (participants.length === 0) {
    throw new Error("Only an assigned participant may change this series");
  }
  return { series, participants };
}

export async function acceptDuelChallenge(
  db: ExtendedPrismaClient,
  seriesId: string,
  discordId: DiscordAccountId,
  guildId: DiscordGuildId,
) {
  const { series, participants } = await participantSeries(
    db,
    seriesId,
    discordId,
    guildId,
  );
  const acceptedDisclosures = await db.duelDisclosureAcceptance.count({
    where: {
      guildId: series.guildId,
      disclosureVersion: DUEL_DISCLOSURE_VERSION,
      playerId: { in: participants.map((participant) => participant.playerId) },
      discordId,
    },
  });
  if (acceptedDisclosures !== participants.length) {
    throw new Error("Accept the custom-match disclosure before joining a duel");
  }
  await db.duelSeriesParticipant.updateMany({
    where: {
      seriesId,
      playerId: { in: participants.map((participant) => participant.playerId) },
    },
    data: { discordId, acceptedAt: new Date() },
  });
  return { deadlineAt: series.deadlineAt ?? new Date() };
}

export async function markDuelReady(
  db: ExtendedPrismaClient,
  seriesId: string,
  discordId: DiscordAccountId,
  guildId: DiscordGuildId,
) {
  const { series, participants } = await participantSeries(
    db,
    seriesId,
    discordId,
    guildId,
  );
  if (participants.some((participant) => participant.acceptedAt === null)) {
    throw new Error("Accept the duel before marking ready");
  }
  await db.duelSeriesParticipant.updateMany({
    where: {
      seriesId,
      playerId: { in: participants.map((participant) => participant.playerId) },
      acceptedAt: { not: null },
    },
    data: { discordId, readyAt: new Date() },
  });
  return { deadlineAt: series.deadlineAt ?? new Date() };
}

export async function getDuelSeries(
  db: ExtendedPrismaClient,
  seriesId: string,
  viewerDiscordId: DiscordAccountId,
  guildId: DiscordGuildId,
) {
  const series = await db.duelSeries.findFirstOrThrow({
    where: { id: seriesId, guildId },
    include: {
      competitorOne: { include: { members: true } },
      competitorTwo: { include: { members: true } },
      participants: true,
      games: { orderBy: { gameNumber: "asc" } },
      auditDecisions: { orderBy: { createdAt: "asc" } },
    },
  });
  const currentDiscordIdByPlayer = await currentParticipantDiscordIds(
    db,
    guildId,
    series.participants,
  );
  const allAccepted = series.participants.every(
    (participant) =>
      participant.acceptedAt !== null &&
      effectiveParticipantDiscordId(currentDiscordIdByPlayer, participant) ===
        participant.discordId,
  );
  const authorized =
    allAccepted ||
    series.organizerDiscordId === viewerDiscordId ||
    series.participants.some(
      (participant) =>
        effectiveParticipantDiscordId(currentDiscordIdByPlayer, participant) ===
        viewerDiscordId,
    );
  if (!authorized) {
    throw new Error("This duel is private until every participant accepts");
  }
  return {
    id: series.id,
    guildId: series.guildId,
    eventId: series.eventId,
    isOrganizer: series.organizerDiscordId === viewerDiscordId,
    state: DuelSeriesStatusSchema.parse(series.seriesState),
    bestOf: DuelBestOfSchema.parse(series.bestOf),
    ruleset: DuelRulesetV1Schema.parse(JSON.parse(series.rulesetJson)),
    deadlineAt: series.deadlineAt?.toISOString() ?? null,
    winnerCompetitorId: series.winnerCompetitorId,
    competitorOne: parseDuelCompetitor(series.competitorOne),
    competitorTwo: parseDuelCompetitor(series.competitorTwo),
    participants: series.participants.map((participant) => ({
      playerId: participant.playerId,
      competitorId: participant.competitorId,
      accepted: participant.acceptedAt !== null,
      ready: participant.readyAt !== null,
    })),
    games: series.games.map((game) => ({
      id: game.id,
      gameNumber: game.gameNumber,
      state: game.gameState,
      resultState: game.resultState,
      matchId: game.matchId,
      winnerCompetitorId: game.winnerCompetitorId,
      objective: game.objective,
      objectiveTimestampMs: game.objectiveTimestampMs,
      reviewReason: game.reviewReason,
    })),
    auditDecisions: series.auditDecisions.map((decision) => ({
      action: decision.action,
      reason: decision.reason,
      createdAt: decision.createdAt.toISOString(),
    })),
  };
}

export async function getDuelCode(
  db: ExtendedPrismaClient,
  seriesId: string,
  viewerDiscordId: DiscordAccountId,
  guildId: DiscordGuildId,
) {
  const series = await db.duelSeries.findFirstOrThrow({
    where: { id: seriesId, guildId },
    include: {
      participants: true,
      games: {
        orderBy: { gameNumber: "desc" },
        take: 1,
        include: { tournamentLobby: true },
      },
    },
  });
  const currentDiscordIdByPlayer = await currentParticipantDiscordIds(
    db,
    guildId,
    series.participants,
  );
  if (
    !series.participants.some(
      (participant) =>
        effectiveParticipantDiscordId(currentDiscordIdByPlayer, participant) ===
        viewerDiscordId,
    )
  ) {
    throw new Error(
      "Tournament codes are visible only to assigned participants",
    );
  }
  if (
    !series.participants.every((participant) => participant.readyAt !== null)
  ) {
    throw new Error(
      "The tournament code is unavailable until everyone is ready",
    );
  }
  const game = series.games[0];
  if (game?.gameState !== "code_ready" || series.seriesState !== "code_ready") {
    throw new Error("The tournament code is not ready yet");
  }
  if (game.tournamentLobby === null) {
    throw new Error("The tournament code is not ready yet");
  }
  return {
    gameId: game.id,
    gameNumber: game.gameNumber,
    code: game.tournamentLobby.code,
    stub: game.tournamentLobby.apiMode === "stub",
  };
}
