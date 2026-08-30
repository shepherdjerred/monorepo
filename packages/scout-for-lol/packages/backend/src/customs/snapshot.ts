import {
  CustomAvailabilitySchema,
  CustomGameSnapshotSchema,
  CustomGameStateSchema,
  CustomMapSchema,
  CustomNightSnapshotSchema,
  CustomNightStateSchema,
  CustomPickModeSchema,
  CustomRoleSchema,
  CustomRosterModeSchema,
  CustomSideSchema,
  CustomTeamSchema,
  CustomVoiceStateSchema,
  CustomWinnerSchema,
  type CustomAccount,
  type CustomGameSnapshot,
  type CustomNightParticipant,
  type CustomNightSnapshot,
  CustomHistorySchema,
  type CustomHistory,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { TournamentLobbyStateSchema } from "#src/league/tournament/lifecycle.ts";

async function loadNight(client: ExtendedPrismaClient, nightId: string) {
  return client.customNight.findUnique({
    where: { id: nightId },
    include: {
      cohosts: { orderBy: { createdAt: "asc" } },
      participants: { orderBy: { createdAt: "asc" } },
      games: {
        orderBy: { sequence: "asc" },
        include: {
          participants: { orderBy: { rosterOrder: "asc" } },
          tournamentLobby: true,
        },
      },
    },
  });
}

type NightRow = NonNullable<Awaited<ReturnType<typeof loadNight>>>;
type GameRow = NightRow["games"][number];

function accountMap(
  accounts: Awaited<ReturnType<ExtendedPrismaClient["account"]["findMany"]>>,
): Map<number, CustomAccount[]> {
  const byPlayer = new Map<number, CustomAccount[]>();
  for (const account of accounts) {
    const values = byPlayer.get(account.playerId) ?? [];
    values.push({
      accountId: account.id,
      puuid: account.puuid,
      region: account.region,
      riotGameName: account.riotGameName,
      riotTagLine: account.riotTagLine,
    });
    byPlayer.set(account.playerId, values);
  }
  return byPlayer;
}

function participantSnapshot(
  participant: NightRow["participants"][number],
  accounts: ReadonlyMap<number, CustomAccount[]>,
  now: Date,
): CustomNightParticipant {
  const awayOverdue =
    participant.awayUntil !== null &&
    participant.awayUntil.getTime() <= now.getTime();
  return {
    discordId: participant.discordId,
    displayName: participant.displayName,
    avatarUrl: participant.avatarUrl,
    role: CustomRoleSchema.parse(participant.role),
    availability: CustomAvailabilitySchema.parse(participant.availability),
    readyAt: participant.readyAt?.toISOString() ?? null,
    awayUntil: participant.awayUntil?.toISOString() ?? null,
    awayOverdue,
    held: participant.held,
    consentedAt: participant.consentedAt.toISOString(),
    playerId: participant.playerId,
    playerAlias: participant.playerAlias,
    accounts:
      participant.playerId === null
        ? []
        : (accounts.get(participant.playerId) ?? []),
    selectedAccountId: participant.selectedAccountId,
  };
}

function gameSnapshot(game: GameRow, revealCode: boolean): CustomGameSnapshot {
  return CustomGameSnapshotSchema.parse({
    id: game.id,
    sequence: game.sequence,
    state: CustomGameStateSchema.parse(game.state),
    rosterMode: CustomRosterModeSchema.parse(game.rosterMode),
    map: CustomMapSchema.parse(game.map),
    pickMode: CustomPickModeSchema.parse(game.pickMode),
    participants: game.participants.map((participant) => ({
      discordId: participant.discordId,
      displayName: participant.displayName,
      playerId: participant.playerId,
      playerAlias: participant.playerAlias,
      accountId: participant.accountId,
      puuid: participant.puuid,
      riotGameName: participant.riotGameName,
      riotTagLine: participant.riotTagLine,
      rosterOrder: participant.rosterOrder,
      benchOrder: participant.benchOrder,
      team:
        participant.team === null
          ? null
          : CustomTeamSchema.parse(participant.team),
      side:
        participant.side === null
          ? null
          : CustomSideSchema.parse(participant.side),
      captain: participant.captain,
      pickOrder: participant.pickOrder,
      championId: participant.championId,
      won: participant.won,
    })),
    activeCaptain:
      game.activeCaptain === null
        ? null
        : CustomTeamSchema.parse(game.activeCaptain),
    tournamentLobby:
      game.tournamentLobby === null
        ? null
        : {
            state: TournamentLobbyStateSchema.parse(game.tournamentLobby.state),
            code: revealCode ? game.tournamentLobby.code : null,
          },
    winner: game.winner === null ? null : CustomWinnerSchema.parse(game.winner),
    voiceState: CustomVoiceStateSchema.parse(game.voiceState),
    voiceReady: game.voiceReady,
    voiceOverride: game.voiceOverride,
    voiceError: game.voiceError,
    createdAt: game.createdAt.toISOString(),
    startedAt: game.startedAt?.toISOString() ?? null,
    completedAt: game.completedAt?.toISOString() ?? null,
  });
}

function recruitmentCounts(participants: readonly CustomNightParticipant[]) {
  const ready = participants.filter(
    (participant) =>
      participant.availability === "READY" &&
      participant.awayUntil === null &&
      !participant.awayOverdue,
  ).length;
  return {
    ready,
    maybe: participants.filter(
      (participant) => participant.availability === "MAYBE",
    ).length,
    away: participants.filter((participant) => participant.awayUntil !== null)
      .length,
    held: participants.filter((participant) => participant.held).length,
    remaining: Math.max(0, 10 - ready),
  };
}

/** Builds the client contract from normalized rows; no stored snapshot exists. */
export async function buildCustomNightSnapshot(
  client: ExtendedPrismaClient,
  nightId: string,
  viewerDiscordId: string,
  options:
    | Date
    | {
        readonly now?: Date;
        readonly viewerAdministrator?: boolean;
      } = new Date(),
): Promise<CustomNightSnapshot | undefined> {
  const now = options instanceof Date ? options : (options.now ?? new Date());
  const viewerAdministrator =
    options instanceof Date ? false : (options.viewerAdministrator ?? false);
  const night = await loadNight(client, nightId);
  if (night === null) return undefined;

  const playerIds = night.participants.flatMap((participant) =>
    participant.playerId === null ? [] : [participant.playerId],
  );
  const accounts = await client.account.findMany({
    where: { playerId: { in: playerIds } },
    orderBy: { id: "asc" },
  });
  const participants = night.participants.map((participant) =>
    participantSnapshot(participant, accountMap(accounts), now),
  );
  const canRevealCode =
    viewerAdministrator ||
    viewerDiscordId === night.hostDiscordId ||
    night.cohosts.some((cohost) => cohost.discordId === viewerDiscordId);
  const viewerRole = viewerAdministrator
    ? "ADMIN"
    : viewerDiscordId === night.hostDiscordId
      ? "HOST"
      : night.cohosts.some((cohost) => cohost.discordId === viewerDiscordId)
        ? "COHOST"
        : (participants.find(
            (participant) => participant.discordId === viewerDiscordId,
          )?.role ?? "MEMBER");
  const currentGame = night.games.at(-1);

  return CustomNightSnapshotSchema.parse({
    id: night.id,
    guildId: night.guildId,
    guildName: night.guildName,
    launchChannelId: night.launchChannelId,
    voiceLobbyChannelId: night.voiceLobbyChannelId,
    hostDiscordId: night.hostDiscordId,
    cohostDiscordIds: night.cohosts.map((cohost) => cohost.discordId),
    state: CustomNightStateSchema.parse(night.state),
    revision: night.revision,
    viewerRole: CustomRoleSchema.parse(viewerRole),
    participants,
    currentGame:
      currentGame === undefined
        ? null
        : gameSnapshot(currentGame, canRevealCode),
    recruitmentCounts: recruitmentCounts(participants),
    recruitmentMessageId: night.recruitmentMessageId,
    teamAVoiceChannelId: night.teamAVoiceChannelId,
    teamBVoiceChannelId: night.teamBVoiceChannelId,
    lastActivityAt: night.lastActivityAt.toISOString(),
    expiresAt: night.expiresAt.toISOString(),
    endedAt: night.endedAt?.toISOString() ?? null,
  });
}

export async function buildCustomNightHistory(
  client: ExtendedPrismaClient,
  nightId: string,
  viewerDiscordId: string,
  now: Date = new Date(),
): Promise<CustomHistory | undefined> {
  const night = await loadNight(client, nightId);
  if (night === null) return undefined;
  const snapshot = await buildCustomNightSnapshot(
    client,
    nightId,
    viewerDiscordId,
    now,
  );
  if (snapshot === undefined) return undefined;
  const revealCode =
    viewerDiscordId === night.hostDiscordId ||
    night.cohosts.some((cohost) => cohost.discordId === viewerDiscordId);
  const audit = await client.customAuditEvent.findMany({
    where: { nightId },
    orderBy: [{ revision: "asc" }, { createdAt: "asc" }],
  });
  return CustomHistorySchema.parse({
    night: snapshot,
    games: night.games.map((game) => gameSnapshot(game, revealCode)),
    audit: audit.map((event) => ({
      id: event.id,
      nightId: event.nightId,
      gameId: event.gameId,
      revision: event.revision,
      actorId: event.actorId,
      action: event.action,
      payload: JSON.parse(event.payload),
      source: event.source,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
