import { z } from "zod";
import {
  PokemonStateSchema,
  type GameEvent,
  type PokemonState,
} from "@arcade/common/telemetry.ts";
import {
  StatsSchema,
  type CourseRecord,
  type Standing,
  type Stats,
} from "@arcade/common/stats.ts";
import { type GameId, type Player } from "@arcade/common/catalog.ts";
import type { createPrisma } from "@discord-plays-mario-kart/backend/database/index.ts";
import type { RaceState, FightState } from "@arcade/common/telemetry.ts";

type Db = ReturnType<typeof createPrisma>;
type Participants = readonly (Player | null)[];
type RoundIdentity<G extends GameId> = {
  guildId: string;
  gameId: G;
  roundId: string;
};

export class StatsStore {
  constructor(private readonly db: Db) {}

  async recordRace(
    { guildId, gameId, roundId }: RoundIdentity<"mk64" | "mkwii">,
    state: RaceState,
    participants: Participants,
  ): Promise<void> {
    if (state.courseId === null || state.mode === "battle")
      throw new Error("unrecordable race");
    const humans = state.racers.filter(
      (racer) => racer.human && racer.seat !== null,
    );
    if (humans.length === 0) return;
    for (const racer of humans)
      if (racer.placement === null || (racer.finished && racer.timeMs === null))
        throw new Error("race result is incomplete");
    await this.db.race.upsert({
      where: { roundId },
      update: {},
      create: {
        guildId,
        gameId,
        roundId,
        courseId: state.courseId,
        gameMode: state.mode,
        engineClass: state.engineClass,
        mirror: state.mirror,
        humanCount: humans.length,
        results: {
          create: humans.map((racer) => {
            if (racer.seat === null || racer.placement === null)
              throw new Error("invalid human race slot");
            const player = participants[racer.seat];
            return {
              seat: racer.seat,
              discordId: player?.discordId ?? null,
              playerName: player?.name ?? null,
              character: racer.characterId,
              vehicle: racer.vehicleId,
              placement: racer.placement,
              raceTimeMs: racer.timeMs === null ? 0 : Math.round(racer.timeMs),
              finished: racer.finished,
            };
          }),
        },
      },
    });
  }

  async recordFight(
    { guildId, gameId, roundId }: RoundIdentity<"melee" | "brawl">,
    state: FightState,
    participants: Participants,
  ): Promise<void> {
    if (
      state.phase !== "results" ||
      state.mode === "other" ||
      state.teams ||
      state.stageId === null
    )
      throw new Error("unrecordable match");
    const humans = state.fighters.filter((fighter) => fighter.human);
    if (humans.length === 0) return;
    await this.db.smashMatch.upsert({
      where: { roundId },
      update: {},
      create: {
        guildId,
        gameId,
        roundId,
        mode: state.mode,
        stageId: state.stageId,
        results: {
          create: humans.map((fighter) => {
            if (
              fighter.placement === null ||
              fighter.winner === null ||
              fighter.kos === null ||
              fighter.falls === null ||
              fighter.selfDestructs === null
            )
              throw new Error("match result is incomplete");
            const player = participants[fighter.seat];
            return {
              seat: fighter.seat,
              discordId: player?.discordId ?? null,
              playerName: player?.name ?? null,
              character: fighter.characterId,
              placement: fighter.placement,
              winner: fighter.winner,
              kos: fighter.kos,
              falls: fighter.falls,
              selfDestructs: fighter.selfDestructs,
            };
          }),
        },
      },
    });
  }

  async milestone(guildId: string, event: GameEvent): Promise<void> {
    await this.db.pokemonMilestone.upsert({
      where: { id: event.id },
      update: {},
      create: { ...event, guildId, at: new Date(event.at) },
    });
  }

  async progress(guildId: string, state: PokemonState): Promise<void> {
    const stateJson = JSON.stringify(PokemonStateSchema.parse(state));
    await this.db.pokemonProgress.upsert({
      where: { guildId },
      update: { stateJson },
      create: { guildId, stateJson },
    });
  }

  async read(
    guildId: string,
    gameId: GameId,
    discordId?: string,
  ): Promise<Stats> {
    switch (gameId) {
      case "emerald":
        return this.readEmerald(guildId);
      case "mk64":
      case "mkwii":
        return this.readRacing(guildId, gameId, discordId);
      case "melee":
      case "brawl":
        return this.readFighting(guildId, gameId, discordId);
    }
  }

  private async readContext(gameId: Exclude<GameId, "emerald">) {
    const directory = await this.db.player.findMany();
    const players = new Map(
      directory.map((entry) => [
        entry.discordId,
        {
          discordId: entry.discordId,
          name: entry.name,
          avatarUrl: entry.avatarUrl,
        },
      ]),
    );
    const playerFor = (
      id: string | null,
      name: string | null,
    ): Player | null =>
      id === null
        ? null
        : (players.get(id) ?? {
            discordId: id,
            name: name ?? id,
            avatarUrl: null,
          });
    const standings = new Map<string, Standing>();
    function standingFor(
      id: string,
      name: string | null,
      family: "racing" | "fighting",
    ): Standing {
      let standing = standings.get(id);
      if (standing === undefined) {
        const player = playerFor(id, name);
        if (player === null) throw new Error("identified result has no player");
        standing = emptyStanding(player, family, gameId);
        standings.set(id, standing);
      }
      return standing;
    }

    return { playerFor, standingFor, standings };
  }

  private async readEmerald(guildId: string): Promise<Stats> {
    const gameId = "emerald";

    const milestones = await this.db.pokemonMilestone.findMany({
      where: { guildId },
      orderBy: { at: "desc" },
      take: 30,
    });
    const progress = await this.db.pokemonProgress.findUnique({
      where: { guildId },
    });
    return StatsSchema.parse({
      guildId,
      gameId,
      leaderboard: [],
      recent: [],
      records: [],
      totalRounds: 0,
      progress:
        progress === null
          ? null
          : PokemonStateSchema.parse(JSON.parse(progress.stateJson)),
      milestones: milestones.map((event) => ({
        id: event.id,
        at: event.at.toISOString(),
        kind: event.kind,
        title: event.title,
        text: event.text,
      })),
    });
  }

  private async readRacing(
    guildId: string,
    gameId: "mk64" | "mkwii",
    discordId?: string,
  ): Promise<Stats> {
    const { playerFor, standingFor, standings } =
      await this.readContext(gameId);

    const ranked = {
      discordId: { not: null },
      race: { guildId, gameId, gameMode: { in: ["gp", "versus"] } },
    };
    const groups = await this.db.raceResult.groupBy({
      by: ["discordId", "playerName", "character", "placement"],
      where: ranked,
      _count: { _all: true },
    });
    for (const group of groups) {
      if (group.discordId === null) continue;
      const entry = standingFor(group.discordId, group.playerName, "racing");
      const count = group._count._all;
      entry.played += count;
      entry.wins += group.placement === 1 ? count : 0;
      entry.podiums = (entry.podiums ?? 0) + (group.placement <= 3 ? count : 0);
      entry.averagePlacement =
        (entry.averagePlacement ?? 0) + group.placement * count;
      entry.placements[group.placement - 1] =
        (entry.placements[group.placement - 1] ?? 0) + count;
      addCharacter(
        entry,
        group.character,
        count,
        group.placement === 1 ? count : 0,
      );
    }
    const recent = await this.db.race.findMany({
      where: {
        guildId,
        gameId,
        results: {
          some:
            discordId === undefined
              ? { discordId: { not: null } }
              : { discordId },
        },
      },
      orderBy: { id: "desc" },
      take: 20,
      include: { results: true },
    });
    const raw: unknown = await this.db.$queryRaw`
        SELECT r.courseId, r.gameMode AS mode, r.engineClass, r.mirror,
               p.discordId, p.character AS characterId, MIN(p.raceTimeMs) AS timeMs
        FROM Race r JOIN RaceResult p ON p.raceId = r.id
        WHERE r.guildId = ${guildId} AND r.gameId = ${gameId}
          AND p.discordId IS NOT NULL AND p.finished = 1 AND p.raceTimeMs > 0
          AND (${discordId ?? null} IS NULL OR p.discordId = ${discordId ?? null})
        GROUP BY r.courseId, r.gameMode, r.engineClass, r.mirror, p.discordId, p.character
      `;
    for (const entry of standings.values())
      if (entry.averagePlacement !== null)
        entry.averagePlacement /= entry.played;
    return StatsSchema.parse({
      guildId,
      gameId,
      leaderboard: finishStandings(standings),
      records: bestCourseRecords(RecordRowsSchema.parse(raw), playerFor),
      milestones: [],
      progress: null,
      totalRounds: await this.db.race.count({ where: { guildId, gameId } }),
      recent: recent.map((race) => ({
        family: "racing",
        id: String(race.id),
        at: race.finishedAt.toISOString(),
        mode: race.gameMode,
        courseId: race.courseId,
        engineClass: race.engineClass,
        mirror: race.mirror,
        results: race.results.map((result) => ({
          player: playerFor(result.discordId, result.playerName),
          seat: result.seat,
          characterId: result.character,
          placement: result.placement,
          timeMs: result.finished ? result.raceTimeMs : null,
          finished: result.finished,
          vehicleId: result.vehicle,
        })),
      })),
    });
  }

  private async readFighting(
    guildId: string,
    gameId: "melee" | "brawl",
    discordId?: string,
  ): Promise<Stats> {
    const { playerFor, standingFor, standings } =
      await this.readContext(gameId);
    const groups = await this.db.smashResult.groupBy({
      by: ["discordId", "playerName", "character", "winner", "placement"],
      where: { discordId: { not: null }, match: { guildId, gameId } },
      _count: { _all: true },
      _sum: { kos: true, falls: true, selfDestructs: true },
    });
    for (const group of groups) {
      if (group.discordId === null) continue;
      const entry = standingFor(group.discordId, group.playerName, "fighting");
      entry.played += group._count._all;
      entry.wins += group.winner ? group._count._all : 0;
      entry.placements[group.placement - 1] =
        (entry.placements[group.placement - 1] ?? 0) + group._count._all;
      entry.kos = (entry.kos ?? 0) + (group._sum.kos ?? 0);
      entry.falls = (entry.falls ?? 0) + (group._sum.falls ?? 0);
      entry.selfDestructs =
        (entry.selfDestructs ?? 0) + (group._sum.selfDestructs ?? 0);
      addCharacter(
        entry,
        group.character,
        group._count._all,
        group.winner ? group._count._all : 0,
      );
    }
    const recent = await this.db.smashMatch.findMany({
      where: {
        guildId,
        gameId,
        results: {
          some:
            discordId === undefined
              ? { discordId: { not: null } }
              : { discordId },
        },
      },
      orderBy: { id: "desc" },
      take: 20,
      include: { results: true },
    });
    return StatsSchema.parse({
      guildId,
      gameId,
      leaderboard: finishStandings(standings),
      records: [],
      milestones: [],
      progress: null,
      totalRounds: await this.db.smashMatch.count({
        where: { guildId, gameId },
      }),
      recent: recent.map((match) => ({
        family: "fighting",
        id: String(match.id),
        at: match.finishedAt.toISOString(),
        mode: match.mode,
        stageId: match.stageId,
        results: match.results.map((result) => ({
          player: playerFor(result.discordId, result.playerName),
          seat: result.seat,
          characterId: result.character,
          placement: result.placement,
          winner: result.winner,
          kos: result.kos,
          falls: result.falls,
          selfDestructs: result.selfDestructs,
        })),
      })),
    });
  }
}

function addCharacter(
  standing: Standing,
  characterId: number,
  played: number,
  wins: number,
): void {
  const character = standing.characters.find(
    (entry) => entry.characterId === characterId,
  );
  if (character === undefined)
    standing.characters.push({ characterId, played, wins });
  else {
    character.played += played;
    character.wins += wins;
  }
}

function finishStandings(standings: Map<string, Standing>): Standing[] {
  for (const standing of standings.values()) {
    standing.winRate = standing.wins / standing.played;
    standing.characters.sort(
      (a, b) => b.played - a.played || a.characterId - b.characterId,
    );
  }
  return [...standings.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      (a.averagePlacement ?? 0) - (b.averagePlacement ?? 0) ||
      b.played - a.played ||
      a.player.discordId.localeCompare(b.player.discordId),
  );
}

const RecordRowsSchema = z.array(
  z.object({
    courseId: z.number().int(),
    mode: z.enum(["gp", "versus", "time-trials"]),
    engineClass: z.string().nullable(),
    mirror: z.boolean().nullable(),
    discordId: z.string(),
    characterId: z.number().int(),
    timeMs: z.number().positive(),
  }),
);

function emptyStanding(
  player: Player,
  family: "racing" | "fighting",
  gameId: GameId,
): Standing {
  return {
    player,
    played: 0,
    wins: 0,
    winRate: 0,
    podiums: family === "racing" ? 0 : null,
    averagePlacement: family === "racing" ? 0 : null,
    kos: family === "fighting" ? 0 : null,
    falls: family === "fighting" ? 0 : null,
    selfDestructs: family === "fighting" ? 0 : null,
    characters: [],
    placements: Array.from(
      { length: family === "fighting" ? 4 : gameId === "mk64" ? 8 : 12 },
      () => 0,
    ),
  };
}

function bestCourseRecords(
  rows: z.infer<typeof RecordRowsSchema>,
  playerFor: (id: string | null, name: string | null) => Player | null,
): CourseRecord[] {
  const records = new Map<string, CourseRecord>();
  for (const row of rows) {
    const player = playerFor(row.discordId, null);
    if (player === null) throw new Error("course record has no player");
    const key = JSON.stringify([
      row.discordId,
      row.courseId,
      row.mode,
      row.engineClass,
      row.mirror,
    ]);
    const existing = records.get(key);
    if (existing === undefined || row.timeMs < existing.timeMs)
      records.set(key, {
        player,
        courseId: row.courseId,
        mode: row.mode,
        engineClass: row.engineClass,
        mirror: row.mirror,
        characterId: row.characterId,
        timeMs: row.timeMs,
      });
  }
  return [...records.values()];
}
