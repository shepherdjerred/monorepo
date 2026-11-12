import { z } from "zod";
import {
  EndOfGameMatchSchema,
  EndOfGameParticipantSchema,
  SCOUT_CLIENT_END_OF_GAME_DATA_VERSION,
  type EndOfGameMatch,
  type EndOfGameParticipant,
  type EndOfGameTeam,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { EndOfGameBlockGameSchema } from "./end-of-game-result.ts";
import { lcuParticipantIdentity } from "./lcu-identity.ts";
import { lcuParticipantFields } from "./lcu-participant.ts";

/**
 * The end-of-game canonical record (`local-eog-1`): a game converted from the
 * League client's end-of-game block alone, for when the client served no
 * match history for it. Its gameflow session, from the same device, states
 * the queue and map the block names only by string.
 *
 * Every participant stat, item, spell, rune and position comes from the
 * block, as it does in the bundle converter. Team totals are derived from
 * player statistics, and nothing is invented: what no stated fact decides is
 * `null`, never zero (see `EndOfGameMatchSchema`).
 */

const GameIdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform(Number);
const StatsSchema = z.record(z.string(), z.unknown());

const PlayerSchema = z.looseObject({
  puuid: z.string(),
  botPlayer: z.boolean(),
  teamId: z.number().int().positive(),
  championId: z.number().int().positive(),
  championName: z.string().optional(),
  detectedTeamPosition: z.string().optional(),
  items: z.array(z.number().int().nonnegative()).length(7),
  spell1Id: z.number().int().nonnegative(),
  spell2Id: z.number().int().nonnegative(),
  profileIconId: z.number().int().optional(),
  level: z.number().int().optional(),
  riotIdGameName: z.string().optional(),
  riotIdTagLine: z.string().optional(),
  summonerId: z.union([z.string(), z.number()]).transform(String).optional(),
  summonerName: z.string().optional(),
  stats: StatsSchema,
});
type Player = z.infer<typeof PlayerSchema>;

/** The statistics each team total is derived from, as the block states them. */
const TeamStatsSchema = z.looseObject({
  WIN: z.union([z.literal(0), z.literal(1)]),
  kills: z.number().int().nonnegative(),
  baronKills: z.number().int().nonnegative(),
  dragonKills: z.number().int().nonnegative(),
  turretsLost: z.number().int().nonnegative(),
  inhibitorsLost: z.number().int().nonnegative(),
  firstBloodKill: z.union([z.literal(0), z.literal(1)]),
  firstBloodAssist: z.union([z.literal(0), z.literal(1)]),
  firstTowerKill: z.union([z.literal(0), z.literal(1)]),
  firstTowerAssist: z.union([z.literal(0), z.literal(1)]),
});
type TeamStats = z.infer<typeof TeamStatsSchema>;

const EndOfGameBlockSchema = EndOfGameBlockGameSchema.extend({
  gameId: GameIdSchema,
  gameEndedInEarlySurrender: z.boolean(),
  teams: z.array(
    z.looseObject({
      teamId: z.number().int().positive(),
      isWinningTeam: z.boolean(),
      players: z.array(PlayerSchema).min(1),
    }),
  ),
});
type EndOfGameBlock = z.infer<typeof EndOfGameBlockSchema>;

/** The stored gameflow session, as its observation payload carries it. */
const GameflowSchema = z.object({
  resource: z.literal("gameflow_session"),
  data: z.looseObject({
    gameData: z.looseObject({
      gameId: GameIdSchema,
      queue: z.looseObject({
        id: z.number().int().nonnegative(),
        type: z.string(),
        gameMode: z.string(),
        mapId: z.number().int().positive(),
      }),
      bannedChampions: z
        .array(
          z.looseObject({
            championId: z.number().int(),
            teamId: z.number().int(),
            pickTurn: z.number().int(),
          }),
        )
        .optional(),
    }),
  }),
});
type Gameflow = z.infer<typeof GameflowSchema>["data"]["gameData"];

/** The Rift's two sides; the totals below read one side's losses as the other's kills. */
const SIDES = 2;

type Side = {
  readonly teamId: number;
  readonly win: boolean;
  readonly stats: readonly TeamStats[];
};

function sum(stats: readonly TeamStats[], pick: (stat: TeamStats) => number) {
  return stats.reduce((total, stat) => total + pick(stat), 0);
}

/** One value every player on a side states alike, or `null` if they differ. */
function sideValue(
  side: Side,
  pick: (stat: TeamStats) => number,
): number | null {
  const values = new Set(side.stats.map((stat) => pick(stat)));
  const [only] = values;
  return only !== undefined && values.size === 1 ? only : null;
}

/** Decided for one side: it took it, another did, or no fact says. */
function decidedFor(
  teamId: number,
  taker: number | null | undefined,
): boolean | null {
  return taker === undefined ? null : taker === teamId;
}

/**
 * Who took something first from the players' own flags: the one side whose
 * player says so. Nobody took it, so no side did. Neither or both flagging it
 * leaves it undecided (a minion's first tower, an execution's first death).
 */
function firstByFlags(
  sides: readonly Side[],
  taken: boolean,
  flagged: (stat: TeamStats) => boolean,
): ReadonlyMap<number, boolean | null> {
  const claimants = sides.filter((side) =>
    side.stats.some((stat) => flagged(stat)),
  );
  const [claimant] = claimants;
  // `null` is "no side took it"; `undefined` is "no fact says which".
  const taker = taken
    ? claimants.length === 1
      ? claimant?.teamId
      : undefined
    : null;
  return new Map(
    sides.map((side) => [side.teamId, decidedFor(side.teamId, taker)]),
  );
}

/** Who took something first from counts alone: decided only when one side took any. */
function firstByCounts(
  kills: ReadonlyMap<number, number>,
): ReadonlyMap<number, boolean | null> {
  const takers = [...kills].filter(([, count]) => count > 0);
  const [first] = takers;
  const taker =
    takers.length === 0 ? null : takers.length === 1 ? first?.[0] : undefined;
  return new Map(
    [...kills.keys()].map((teamId) => [teamId, decidedFor(teamId, taker)]),
  );
}

function decided(
  firsts: ReadonlyMap<number, boolean | null>,
  teamId: number,
): boolean | null {
  return firsts.get(teamId) ?? null;
}

function bansFor(gameflow: Gameflow, teamId: number) {
  // Gameflow omits `bannedChampions` in every beta capture; an empty or
  // absent list cannot tell "no bans" from "not stated".
  const bans = gameflow.bannedChampions ?? [];
  return bans.length === 0
    ? null
    : bans
        .filter((ban) => ban.teamId === teamId)
        .map((ban) => ({ championId: ban.championId, pickTurn: ban.pickTurn }));
}

function convertTeams(
  block: EndOfGameBlock,
  gameflow: Gameflow,
): EndOfGameTeam[] | null {
  const sides: Side[] = [];
  for (const team of block.teams) {
    const stats = team.players.map((player) =>
      TeamStatsSchema.safeParse(player.stats),
    );
    const parsed = stats.flatMap((stat) => (stat.success ? [stat.data] : []));
    if (parsed.length !== stats.length) return null;
    sides.push({ teamId: team.teamId, win: team.isWinningTeam, stats: parsed });
  }
  if (sides.length !== SIDES) return null;
  // A player's own turret kills miss the towers minions take, so a side's
  // towers and inhibitors destroyed are what the other side states it lost.
  const towers = new Map<number, number>();
  const inhibitors = new Map<number, number>();
  for (const side of sides) {
    const other = sides.find((candidate) => candidate.teamId !== side.teamId);
    if (other === undefined) return null;
    const turretsLost = sideValue(other, (stat) => stat.turretsLost);
    const inhibitorsLost = sideValue(other, (stat) => stat.inhibitorsLost);
    if (turretsLost === null || inhibitorsLost === null) return null;
    towers.set(side.teamId, turretsLost);
    inhibitors.set(side.teamId, inhibitorsLost);
  }

  const championKills = new Map(
    sides.map((side) => [side.teamId, sum(side.stats, (stat) => stat.kills)]),
  );
  const baronKills = new Map(
    sides.map((side) => [
      side.teamId,
      sum(side.stats, (stat) => stat.baronKills),
    ]),
  );
  const dragonKills = new Map(
    sides.map((side) => [
      side.teamId,
      sum(side.stats, (stat) => stat.dragonKills),
    ]),
  );
  const firstBlood = firstByFlags(
    sides,
    [...championKills.values()].some((count) => count > 0),
    (stat) => stat.firstBloodKill === 1 || stat.firstBloodAssist === 1,
  );
  const firstTower = firstByFlags(
    sides,
    [...towers.values()].some((count) => count > 0),
    (stat) => stat.firstTowerKill === 1 || stat.firstTowerAssist === 1,
  );
  const firstBaron = firstByCounts(baronKills);
  const firstDragon = firstByCounts(dragonKills);
  const firstInhibitor = firstByCounts(inhibitors);
  const unstated = { first: null, kills: null };

  return sides.map((side) => ({
    bans: bansFor(gameflow, side.teamId),
    objectives: {
      baron: {
        first: decided(firstBaron, side.teamId),
        kills: baronKills.get(side.teamId) ?? 0,
      },
      champion: {
        first: decided(firstBlood, side.teamId),
        kills: championKills.get(side.teamId) ?? 0,
      },
      dragon: {
        first: decided(firstDragon, side.teamId),
        kills: dragonKills.get(side.teamId) ?? 0,
      },
      inhibitor: {
        first: decided(firstInhibitor, side.teamId),
        kills: inhibitors.get(side.teamId) ?? 0,
      },
      tower: {
        first: decided(firstTower, side.teamId),
        kills: towers.get(side.teamId) ?? 0,
      },
      riftHerald: unstated,
      horde: unstated,
      atakhan: unstated,
    },
    feats: null,
    teamId: side.teamId,
    win: side.win,
  }));
}

function convertPlayer(
  block: EndOfGameBlock,
  team: EndOfGameBlock["teams"][number],
  player: Player,
): EndOfGameParticipant | null {
  const named = lcuParticipantIdentity(player.puuid, player.botPlayer);
  if (named === null || player.teamId !== team.teamId) return null;
  // Facts the block states outside a player's statistics. Riot's surrender
  // flags are per team: an early surrender ends the game for the side that
  // called it, which is the side that lost.
  const stated = {
    ...Object.fromEntries(
      player.items.map((item, slot) => [`item${slot.toString()}`, item]),
    ),
    gameEndedInEarlySurrender: block.gameEndedInEarlySurrender,
    teamEarlySurrendered:
      block.gameEndedInEarlySurrender && !team.isWinningTeam,
    ...(player.detectedTeamPosition === undefined
      ? {}
      : { teamPosition: player.detectedTeamPosition }),
  };
  const parsed = EndOfGameParticipantSchema.safeParse(
    lcuParticipantFields(
      {
        records: [player.stats, stated],
        participantId: null,
        teamId: player.teamId,
        championId: player.championId,
        championName: player.championName,
        skinName: undefined,
        spell1Id: player.spell1Id,
        spell2Id: player.spell2Id,
        timeline: undefined,
        profileIcon: player.profileIconId,
        riotIdGameName: player.riotIdGameName,
        riotIdName: player.summonerName,
        riotIdTagLine: player.riotIdTagLine,
        identityTagLine: undefined,
        summonerId: player.summonerId,
        summonerLevel: player.level,
        summonerName: player.summonerName,
      },
      named,
    ),
  );
  if (!parsed.success) return null;
  // The win the player's statistics state must be the one its team states.
  return parsed.data.win === team.isWinningTeam ? parsed.data : null;
}

/**
 * Convert one end-of-game block into the end-of-game canonical record, or
 * `null` when it does not describe this game completely. `endOfGame` is the
 * block (the `data` of a `post_game` observation) with player identities
 * already translated through aliases; `gameflow` is the same device's stored
 * gameflow session payload for the game.
 */
export function convertEndOfGameMatch(input: {
  readonly matchId: RiotMatchId;
  readonly endOfGame: unknown;
  readonly gameflow: unknown;
}): EndOfGameMatch | null {
  const parsedBlock = EndOfGameBlockSchema.safeParse(input.endOfGame);
  const parsedGameflow = GameflowSchema.safeParse(input.gameflow);
  if (!parsedBlock.success || !parsedGameflow.success) return null;
  const block = parsedBlock.data;
  const gameflow = parsedGameflow.data.data.gameData;
  if (
    !input.matchId.endsWith(`_${block.gameId.toString()}`) ||
    gameflow.gameId !== block.gameId ||
    gameflow.queue.type !== block.queueType ||
    gameflow.queue.gameMode !== block.gameMode
  )
    return null;
  const participants: EndOfGameParticipant[] = [];
  for (const team of block.teams) {
    for (const player of team.players) {
      const participant = convertPlayer(block, team, player);
      if (participant === null) return null;
      participants.push(participant);
    }
  }
  const teams = convertTeams(block, gameflow);
  if (teams === null) return null;
  const durationMs = Math.round(block.gameLength * 1000);
  const parsed = EndOfGameMatchSchema.safeParse({
    metadata: {
      dataVersion: SCOUT_CLIENT_END_OF_GAME_DATA_VERSION,
      matchId: input.matchId,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: {
      // The block itself is the client's proof that this game ended.
      endOfGameResult: "GameComplete",
      gameCreation: null,
      gameDuration: block.gameLength,
      gameEndTimestamp: block.endOfGameTimestamp,
      gameId: block.gameId,
      gameMode: block.gameMode,
      gameStartTimestamp: block.endOfGameTimestamp - durationMs,
      gameType: block.gameType,
      gameVersion: null,
      mapId: gameflow.queue.mapId,
      participants,
      platformId: platformRouteOf(input.matchId),
      queueId: gameflow.queue.id,
      teams,
    },
  });
  return parsed.success ? parsed.data : null;
}
