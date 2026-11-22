import { z } from "zod";
import {
  HistoryMatchSchema,
  HistoryParticipantSchema,
  SCOUT_CLIENT_HISTORY_DATA_VERSION,
  type HistoryMatch,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { lcuParticipantIdentity } from "./lcu-identity.ts";
import { convertTeams, fieldedSides, MIN_FIELDED_SIDES } from "./lcu-match.ts";
import { lcuParticipantFields } from "./lcu-participant.ts";
import { LegacyMatchSchema } from "./lcu-schema.ts";
import { isArenaClientPayload } from "./unsupported-mode.ts";

/**
 * A history bundle: the League client's match-history game and, when it
 * served one, its timeline, with nothing witnessed alongside. A bundle that
 * carries an end-of-game block, a replay or witnessed timing is a witnessed
 * game and converts through `convertLcuMatchBundle` instead.
 */
const HistoryBundleSchema = z
  .object({
    matchHistory: LegacyMatchSchema.extend({
      // The row's own completion marker; only a finished game is recorded.
      endOfGameResult: z.literal("GameComplete"),
    }),
    timeline: z.unknown().optional(),
  })
  .strict();

/**
 * The history canonical record (`local-history-1`) for a game the Scout
 * Client did not witness, from the League client's match history alone, or
 * `null` when the bundle does not describe the game completely.
 *
 * Every statistic, item, spell and rune comes from the history row; what it
 * does not state is `null` (`HISTORY_UNSTATED_PARTICIPANT_FIELDS`). Teams come
 * from the row's team totals, exactly as the full-bundle converter derives
 * them. The row states no start or end instant, so the game is placed at its
 * stated creation and ends a stated duration later: the start is at most the
 * loading screen early, and the order between games is kept.
 *
 * Arena is refused: Riot publishes it.
 */
export function convertHistoryMatch(
  riotMatchId: RiotMatchId,
  payload: unknown,
): HistoryMatch | null {
  if (isArenaClientPayload(payload)) return null;
  const parsed = HistoryBundleSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { matchHistory: game, timeline } = parsed.data;
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
    const named = lcuParticipantIdentity(identity.player.puuid, undefined);
    if (named === null) return [];
    const fields = lcuParticipantFields(
      {
        records: [participant.stats],
        participantId: participant.participantId,
        teamId: participant.teamId,
        championId: participant.championId,
        championName: participant.championName,
        skinName: undefined,
        spell1Id: participant.spell1Id,
        spell2Id: participant.spell2Id,
        timeline: participant.timeline,
        profileIcon: identity.player.profileIcon,
        riotIdGameName: identity.player.gameName,
        riotIdName: identity.player.summonerName,
        riotIdTagLine: undefined,
        identityTagLine: identity.player.tagLine,
        summonerId: identity.player.summonerId,
        summonerLevel: undefined,
        summonerName: identity.player.summonerName,
      },
      named,
    );
    return [fields];
  });
  if (
    participants.length !== game.participants.length ||
    participants.length !== game.participantIdentities.length
  )
    return null;
  const typed = participants.map((fields) =>
    HistoryParticipantSchema.safeParse(fields),
  );
  const converted = typed.flatMap((result) =>
    result.success ? [result.data] : [],
  );
  if (
    converted.length !== typed.length ||
    fieldedSides(converted) < MIN_FIELDED_SIDES
  )
    return null;
  const teams = convertTeams({ matchHistory: game, timeline }, converted);
  if (teams === null) return null;
  const record = HistoryMatchSchema.safeParse({
    metadata: {
      dataVersion: SCOUT_CLIENT_HISTORY_DATA_VERSION,
      matchId: riotMatchId,
      participants: converted.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: {
      endOfGameResult: game.endOfGameResult,
      gameCreation: game.gameCreation,
      gameDuration: game.gameDuration,
      gameEndTimestamp:
        game.gameCreation + Math.round(game.gameDuration * 1000),
      gameId: game.gameId,
      gameMode: game.gameMode,
      gameStartTimestamp: game.gameCreation,
      gameType: game.gameType,
      gameVersion: game.gameVersion,
      mapId: game.mapId,
      participants: converted,
      platformId: game.platformId,
      queueId: game.queueId,
      teams,
    },
  });
  return record.success ? record.data : null;
}
