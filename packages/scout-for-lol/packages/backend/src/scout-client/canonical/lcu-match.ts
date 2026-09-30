import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import { convertParticipant } from "./lcu-participant.ts";
import {
  LocalMatchBundleSchema,
  SourcePlayerSchema,
  type LocalMatchBundle,
  type Replay,
  type SourcePlayer,
  type ValueRecord,
} from "./lcu-schema.ts";

export const LOCAL_MATCH_TIMING_DRIFT_MS = 30_000;

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
 * Combine the complete local sources exposed around post-game: legacy match
 * metadata plus per-participant EOG or ROFL statistics. Every Match-V5 field
 * is sourced or derived from an explicit local fact; incomplete bundles fail
 * closed instead of receiving plausible-looking zeroes.
 */
export function convertLcuMatchBundle(
  riotMatchId: string,
  payload: unknown,
): RawMatch | null {
  const parsed = LocalMatchBundleSchema.safeParse(payload);
  if (!parsed.success) return null;
  const bundle = parsed.data;
  // Match-history rows do not carry Match-V5's completion marker. The EOG
  // payload is the locally observed transition that proves this game ended.
  if (bundle.endOfGame === undefined) return null;
  const game = bundle.matchHistory;
  const observedDuration =
    bundle.timing.gameEndTimestamp - bundle.timing.gameStartTimestamp;
  if (
    observedDuration <= 0 ||
    Math.abs(observedDuration - game.gameDuration * 1000) >
      LOCAL_MATCH_TIMING_DRIFT_MS
  ) {
    return null;
  }
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
    const source = players.find(
      (player) => sourcePuuid(player) === identity.player.puuid,
    );
    if (source === undefined) return [];
    const converted = convertParticipant(participant, identity, source);
    return converted === null ? [] : [converted];
  });
  if (
    participants.length !== game.participants.length ||
    participants.length !== game.participantIdentities.length
  ) {
    return null;
  }

  const converted = RawMatchSchema.safeParse({
    metadata: {
      dataVersion: "local-1",
      matchId: riotMatchId,
      participants: participants.map((participant) => participant.puuid),
    },
    info: {
      endOfGameResult: "GameComplete",
      gameCreation: game.gameCreation,
      gameDuration: game.gameDuration,
      gameEndTimestamp: bundle.timing.gameEndTimestamp,
      gameId: game.gameId,
      gameMode: game.gameMode,
      gameName: game.gameName,
      gameStartTimestamp: bundle.timing.gameStartTimestamp,
      gameType: game.gameType,
      gameVersion: game.gameVersion,
      mapId: game.mapId,
      participants,
      platformId: game.platformId,
      queueId: game.queueId,
      teams: game.teams.map((team) => ({
        bans: team.bans,
        objectives: {
          baron: { first: team.firstBaron, kills: team.baronKills },
          champion: {
            first: team.firstBlood,
            kills: participants
              .filter((participant) => participant.teamId === team.teamId)
              .reduce((sum, participant) => sum + participant.kills, 0),
          },
          dragon: { first: team.firstDragon, kills: team.dragonKills },
          inhibitor: {
            first: team.firstInhibitor,
            kills: team.inhibitorKills,
          },
          riftHerald: {
            first: team.firstRiftHerald,
            kills: team.riftHeraldKills,
          },
          tower: { first: team.firstTower, kills: team.towerKills },
        },
        teamId: team.teamId,
        win: team.win === true || team.win === "Win",
      })),
      tournamentCode: game.tournamentCode,
    },
  });
  return converted.success ? converted.data : null;
}
