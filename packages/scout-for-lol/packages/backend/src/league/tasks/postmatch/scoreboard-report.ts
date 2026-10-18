import {
  ClassicMatchSchema,
  getClassicChampionId,
  getClassicSpellId,
  resolveClassicChampionKey,
  resolveQueueTypeFromGame,
  type ClassicMatch,
  type PlayerConfigEntry,
} from "@scout-for-lol/data";
import type { GameResult } from "@scout-for-lol/domain/artifacts/game-result.ts";

/** Renderer capability: enough stated scoreboard facts, independent of their source. */
export function buildScoreboardReport(
  result: GameResult,
  trackedPlayers: PlayerConfigEntry[],
): ClassicMatch | null {
  const queue = resolveQueueTypeFromGame(
    result.queueId,
    result.gameMode,
    result.gameType,
  );
  if (queue !== "classic" && queue !== "classic aram mayhem") return null;
  if (
    result.participants.some(
      (player) =>
        player.identity.kind === "bot" || player.identity.kind === "unresolved",
    )
  )
    return null;
  const champions = result.participants.map((player) => {
    const name = player.name?.split("#");
    return {
      puuid:
        player.identity.kind === "riot"
          ? player.identity.puuid
          : player.identity.kind === "local"
            ? player.identity.uuid
            : undefined,
      riotIdGameName: name?.[0],
      riotIdTagLine: name?.[1],
      championId: getClassicChampionId(player.championId),
      championName: resolveClassicChampionKey(player.championId),
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      level: player.level,
      items: player.items,
      spells: player.spells?.map((spell) => getClassicSpellId(spell)),
      gold: player.gold,
      creepScore:
        player.minions === null || player.jungleMinions == null
          ? null
          : player.minions + player.jungleMinions,
    };
  });
  const players = trackedPlayers.flatMap((playerConfig) => {
    const index = result.participants.findIndex(
      (player) =>
        player.identity.kind === "riot" &&
        player.identity.puuid === playerConfig.league.leagueAccount.puuid,
    );
    const player = result.participants[index];
    const champion = champions[index];
    return player === undefined
      ? []
      : [
          {
            playerConfig,
            champion,
            outcome: player.win ? "Victory" : "Defeat",
            team: player.teamId === 100 ? "blue" : "red",
          },
        ];
  });
  if (
    result.participants.some(
      (player) => player.teamId !== 100 && player.teamId !== 200,
    )
  )
    return null;
  const parsed = ClassicMatchSchema.safeParse({
    durationInSeconds: result.durationSeconds,
    queueType: queue,
    mapName: queue === "classic" ? "Classic Rift" : "The Bandlewood",
    players,
    teams: {
      blue: champions.filter(
        (_, index) => result.participants[index]?.teamId === 100,
      ),
      red: champions.filter(
        (_, index) => result.participants[index]?.teamId === 200,
      ),
    },
  });
  return parsed.success ? parsed.data : null;
}
