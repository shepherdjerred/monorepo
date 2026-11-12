import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  RawMatchSchema,
  RawParticipantSchema,
  SCOUT_CLIENT_DATA_VERSION,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  ARENA_UNSUPPORTED,
  isArenaClientPayload,
  type UnsupportedClientMode,
} from "./unsupported-mode.ts";
import type { ParticipantIdentity } from "@scout-for-lol/domain/artifacts/game-result.ts";
import { lcuParticipantIdentity } from "./lcu-identity.ts";
import { lcuParticipantFields } from "./lcu-participant.ts";
import { firstObjectiveTeam } from "./lcu-team.ts";
import {
  LocalMatchBundleSchema,
  LocalMatchCompletionSchema,
  SourcePlayerSchema,
  type LegacyIdentity,
  type LegacyParticipant,
  type LocalMatchBundle,
  type Replay,
  type SourcePlayer,
  type ValueRecord,
} from "./lcu-schema.ts";

export const LOCAL_MATCH_TIMING_DRIFT_MS = 30_000;

/** Completion uses the witnessed playable interval, independently of lobby creation. */
export function localMatchEndTimestamp(payload: unknown): number | null {
  const parsed = LocalMatchCompletionSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { matchHistory, timing } = parsed.data;
  const duration = timing.gameEndTimestamp - timing.gameStartTimestamp;
  return duration > 0 &&
    Math.abs(duration - matchHistory.gameDuration * 1000) <=
      LOCAL_MATCH_TIMING_DRIFT_MS
    ? timing.gameEndTimestamp
    : null;
}

/**
 * A finished game has players on at least two sides — a 1v1 custom has
 * exactly two. A match-history list row names only the local player, so it
 * fields one side and is refused rather than published as a one-player match.
 * Counted from the players, not `teams`: an Arena game lists teams 100 and 0
 * while its players sit on 100 and 200.
 */
const MIN_FIELDED_SIDES = 2;

function fieldedSides(participants: readonly { teamId: number }[]): number {
  return new Set(participants.map((participant) => participant.teamId)).size;
}

function stringFrom(record: ValueRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function replayPlayers(replay: Replay): SourcePlayer[] {
  return replay.stats.flatMap((stats) => {
    const puuid = stringFrom(stats, "puuid", "PUUID");
    if (puuid === null) return [];
    const parsed = SourcePlayerSchema.safeParse({ puuid, stats });
    return parsed.success ? [parsed.data] : [];
  });
}

function sourcePlayers(bundle: LocalMatchBundle) {
  if (bundle.replay !== undefined) return replayPlayers(bundle.replay);
  if (bundle.endOfGame === undefined) return [];
  return [
    ...(bundle.endOfGame.players ?? []),
    ...(bundle.endOfGame.teams ?? []).flatMap((team) => team.players),
  ];
}

function sourcePuuid(player: SourcePlayer) {
  return player.puuid ?? stringFrom(player.stats, "puuid", "PUUID");
}

/**
 * The statistics source for one history participant, with who it names.
 *
 * A player is matched by identity. Every bot carries the same zero UUID, so a
 * bot is matched by team and champion instead, against a source that states
 * it is a bot; a source that can't single one out leaves the game unconverted.
 */
function matchSource(
  participant: LegacyParticipant,
  identity: LegacyIdentity,
  players: readonly SourcePlayer[],
) {
  const named = lcuParticipantIdentity(identity.player.puuid, undefined);
  if (named === null) return null;
  const candidates =
    named.kind === "bot"
      ? players.filter(
          (player) =>
            player.botPlayer === true &&
            player.teamId === participant.teamId &&
            player.championId === participant.championId,
        )
      : players.filter(
          (player) =>
            player.botPlayer !== true &&
            sourcePuuid(player) === identity.player.puuid,
        );
  const [source] = candidates;
  return source === undefined || candidates.length !== 1
    ? null
    : { source, named };
}

/**
 * One Match-V5 participant from a history row and its statistics source.
 * `named` is who the row names, already decided by the bundle converter.
 */
export function convertParticipant(
  participant: LegacyParticipant,
  identity: LegacyIdentity,
  source: SourcePlayer,
  named: ParticipantIdentity,
) {
  const converted = RawParticipantSchema.safeParse(
    lcuParticipantFields(
      {
        records: [source.stats, participant.stats],
        participantId: participant.participantId,
        teamId: participant.teamId,
        championId: participant.championId,
        championName: participant.championName,
        skinName: source.skinName,
        spell1Id: participant.spell1Id,
        spell2Id: participant.spell2Id,
        timeline: participant.timeline,
        profileIcon: source.profileIconId ?? identity.player.profileIcon,
        riotIdGameName: source.riotIdGameName ?? identity.player.gameName,
        riotIdName: identity.player.summonerName,
        riotIdTagLine: source.riotIdTagLine,
        identityTagLine: identity.player.tagLine,
        summonerId: source.summonerId ?? identity.player.summonerId,
        summonerLevel: source.level,
        summonerName: source.summonerName ?? identity.player.summonerName,
      },
      named,
    ),
  );
  return converted.success ? converted.data : null;
}

/**
 * Combine the complete local sources exposed around post-game: legacy match
 * metadata plus per-participant EOG or ROFL statistics. Every Match-V5 field
 * is sourced or derived from an explicit local fact; incomplete bundles fail
 * closed instead of receiving plausible-looking zeroes.
 */
export function convertLcuMatchBundle(
  riotMatchId: RiotMatchId,
  payload: unknown,
): RawMatch | null {
  const outcome = convertLcuMatchBundleChecked(riotMatchId, payload);
  return outcome.kind === "converted" ? outcome.match : null;
}

export type LcuConversion =
  | { kind: "converted"; match: RawMatch }
  | UnsupportedClientMode
  | { kind: "incomplete" };

/**
 * Like {@link convertLcuMatchBundle}, but names why nothing was produced.
 * Arena is refused before any conversion: Riot publishes its results, and
 * the converter would otherwise drop placement, subteams and augments.
 */
export function convertLcuMatchBundleChecked(
  riotMatchId: RiotMatchId,
  payload: unknown,
): LcuConversion {
  if (isArenaClientPayload(payload)) return ARENA_UNSUPPORTED;
  const match = convertSupportedLcuMatchBundle(riotMatchId, payload);
  return match === null ? { kind: "incomplete" } : { kind: "converted", match };
}

function convertSupportedLcuMatchBundle(
  riotMatchId: RiotMatchId,
  payload: unknown,
): RawMatch | null {
  const parsed = LocalMatchBundleSchema.safeParse(payload);
  if (!parsed.success) return null;
  const bundle = parsed.data;
  // Match-history rows do not carry Match-V5's completion marker. The EOG
  // payload is the locally observed transition that proves this game ended.
  if (bundle.endOfGame === undefined) return null;
  const game = bundle.matchHistory;
  const completedAt = localMatchEndTimestamp(bundle);
  if (completedAt === null) return null;
  const players = sourcePlayers(bundle);
  const identities = new Map(
    game.participantIdentities.map((identity) => [
      identity.participantId,
      identity,
    ]),
  );
  if (identities.size !== game.participantIdentities.length) return null;

  const participants = game.participants.flatMap((participant) => {
    const identity = identities.get(participant.participantId);
    if (identity === undefined) return [];
    const matched = matchSource(participant, identity, players);
    if (matched === null) return [];
    const converted = convertParticipant(
      participant,
      identity,
      matched.source,
      matched.named,
    );
    return converted === null ? [] : [converted];
  });
  if (
    participants.length !== game.participants.length ||
    participants.length !== game.participantIdentities.length ||
    fieldedSides(participants) < MIN_FIELDED_SIDES
  ) {
    return null;
  }
  const teams = convertTeams(bundle, participants);
  if (teams === null) return null;

  const converted = RawMatchSchema.safeParse({
    metadata: {
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      matchId: riotMatchId,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: {
      endOfGameResult: "GameComplete",
      gameCreation: game.gameCreation,
      gameDuration: game.gameDuration,
      gameEndTimestamp: completedAt,
      gameId: game.gameId,
      gameMode: game.gameMode,
      ...(game.gameName === undefined ? {} : { gameName: game.gameName }),
      gameStartTimestamp: bundle.timing.gameStartTimestamp,
      gameType: game.gameType,
      gameVersion: game.gameVersion,
      mapId: game.mapId,
      participants,
      platformId: game.platformId,
      queueId: game.queueId,
      teams,
      tournamentCode: game.tournamentCode,
    },
  });
  return converted.success ? converted.data : null;
}

/**
 * Match-V5 teams, or `null` when a required "first" can't be proven. Rift
 * Herald's comes from the payload when stated, otherwise from kill counts and
 * the timeline. Voidgrubs, optional in Match-V5, appear only when provable.
 */
function convertTeams(
  bundle: LocalMatchBundle,
  participants: readonly { teamId: number; kills: number }[],
) {
  const game = bundle.matchHistory;
  const statedHerald = game.teams.every(
    (team) => team.firstRiftHerald !== undefined,
  );
  const heraldTeam = statedHerald
    ? (game.teams.find((team) => team.firstRiftHerald === true)?.teamId ?? null)
    : firstObjectiveTeam({
        game,
        timeline: bundle.timeline,
        kills: (team) => team.riftHeraldKills,
        monsterType: "RIFTHERALD",
      });
  if (heraldTeam === undefined) return null;
  const hordeTeam = firstObjectiveTeam({
    game,
    timeline: bundle.timeline,
    kills: (team) => team.hordeKills,
    monsterType: "HORDE",
  });
  const teams = game.teams.flatMap((team) => {
    const firstDragon = team.firstDragon ?? team.firstDargon;
    if (firstDragon === undefined) return [];
    return [
      {
        bans: team.bans,
        objectives: {
          baron: { first: team.firstBaron, kills: team.baronKills },
          champion: {
            first: team.firstBlood,
            kills: participants
              .filter((participant) => participant.teamId === team.teamId)
              .reduce((sum, participant) => sum + participant.kills, 0),
          },
          dragon: { first: firstDragon, kills: team.dragonKills },
          ...(hordeTeam === undefined || team.hordeKills === undefined
            ? {}
            : {
                horde: {
                  first: hordeTeam === team.teamId,
                  kills: team.hordeKills,
                },
              }),
          inhibitor: {
            first: team.firstInhibitor,
            kills: team.inhibitorKills,
          },
          riftHerald: {
            first: heraldTeam === team.teamId,
            kills: team.riftHeraldKills,
          },
          tower: { first: team.firstTower, kills: team.towerKills },
        },
        teamId: team.teamId,
        win: team.win === true || team.win === "Win",
      },
    ];
  });
  return teams.length === game.teams.length ? teams : null;
}
