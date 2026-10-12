import {
  LoadingScreenChampionIdSchema,
  type NonStandardLoadingScreenParticipant,
  type StandardLoadingScreenParticipant,
} from "@scout-for-lol/data/index.ts";
import {
  getChampionDisplayName,
  resolveChampionKey,
} from "#src/utils/champion.ts";
import type { ObservedLobbyBot } from "#src/scout-client/lobby-payload.ts";

/**
 * A bot the local client observed, as a loading-screen participant.
 *
 * The lobby states a bot's champion and its slot, and that is the whole of
 * what a bot has: no PUUID, no summoner spells, no rank, no mastery, no runes.
 * `puuid: null` with a hidden `rankState` and absent spells is the schema's
 * existing representation of a participant that cannot be identified — the
 * same shape a privacy-scrubbed player already takes — so nothing here is
 * invented to fill a column.
 *
 * The name is the label the League client itself shows for a bot, because a
 * bot has no name of its own and `summonerName` is what the card renders.
 */
export function buildBotParticipant(
  bot: ObservedLobbyBot,
): NonStandardLoadingScreenParticipant {
  const championDisplayName = getChampionDisplayName(bot.championId);
  return {
    puuid: null,
    summonerName: `${championDisplayName} Bot`,
    championId: LoadingScreenChampionIdSchema.parse(bot.championId),
    championName: resolveChampionKey(bot.championId),
    championDisplayName,
    team: bot.side,
    rankState: { status: "hidden" },
    isTrackedPlayer: false,
  };
}

/**
 * A bot on a standard 5v5 screen, with the lane the client assigned it.
 *
 * Stated rather than inferred: `botPosition` names the slot the bot was put
 * in, which is better evidence than the lane-prior model could produce — and
 * that model reads summoner spells, which a bot does not have.
 */
export function buildStandardBotParticipant(
  bot: ObservedLobbyBot,
): StandardLoadingScreenParticipant {
  return { ...buildBotParticipant(bot), team: bot.side, lane: bot.lane };
}
