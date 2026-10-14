import { z } from "zod";
import { FightStateSchema, type FightState } from "@arcade/common/telemetry.ts";

const Word = z.number().int().min(0).max(0xff_ff_ff_ff);
const PlayerMemory = z.strictObject({
  initial: Word,
  controller: Word,
  identity: Word,
  rank: Word,
  kos: Word,
  falls: Word,
  selfDestructs: Word,
});

/** CPU-thread reads for the pinned RSBE01 revision 2 layout. */
export const BrawlMemorySchema = z.strictObject({
  scene: z.string().max(32),
  modeRule: Word,
  stage: Word,
  teams: Word,
  decision: Word,
  elapsedFrames: Word,
  remainingFrames: Word.nullable(),
  players: z.array(PlayerMemory).length(4),
  owners: z
    .array(
      z.strictObject({
        playerNo: Word,
        stocks: Word,
        damage: z.number().nonnegative().nullable(),
      }),
    )
    .max(7),
});
export type BrawlMemory = z.infer<typeof BrawlMemorySchema>;
type Match = Pick<FightState, "round" | "mode" | "teams" | "stageId"> & {
  players: {
    index: number;
    seat: number;
    human: boolean;
    characterId: number;
  }[];
};

/** Menus contain plausible placeholder results; only a played round can finish. */
export class BrawlTelemetry {
  private round = 0;
  private match: Match | undefined;

  update(memory: BrawlMemory): FightState {
    if (memory.scene === "scVsResult" && this.match !== undefined)
      return this.result(memory, this.match);
    if (memory.scene !== "scMelee" || memory.modeRule >>> 26 !== 0) {
      this.match = undefined;
      return this.empty("menu");
    }
    this.match ??= this.start(memory);
    if (this.match.players.length === 0) {
      this.match = undefined;
      return this.empty("loading");
    }
    const match = this.match;
    const suddenDeath =
      match.mode === "time" &&
      memory.owners.some(
        (owner) => owner.stocks !== 0xff_ff_ff_ff && owner.stocks <= 99,
      );
    return FightStateSchema.parse({
      family: "fighting",
      round: match.round,
      mode: match.mode,
      teams: match.teams,
      stageId: match.stageId,
      phase: suddenDeath ? "sudden-death" : "playing",
      remainingMs:
        memory.remainingFrames === null
          ? null
          : Math.round((memory.remainingFrames * 1000) / 60),
      fighters: match.players.map((player) => this.liveFighter(memory, player)),
    });
  }

  private start(memory: BrawlMemory): Match {
    const rule = (memory.modeRule >>> 21) & 7;
    return {
      round: ++this.round,
      mode: rule === 0 ? "time" : rule === 1 ? "stock" : "other",
      teams: (memory.teams & 0xff) !== 0,
      stageId: memory.stage & 0xff_ff,
      players: memory.players.flatMap((player, index) => {
        const characterId = player.initial >>> 24;
        const state = (player.initial >>> 16) & 0xff;
        if (characterId === 62 || characterId === 255 || state > 1) return [];
        if (characterId > 61 && ![72, 73, 74].includes(characterId))
          throw new Error("Brawl returned an unsupported character selection");
        const human = state === 0;
        const seat = human ? (player.controller & 0xff) - 1 : index;
        if (seat < 0 || seat > 3)
          throw new Error("Brawl returned an unsupported controller port");
        return [{ index, seat, human, characterId }];
      }),
    };
  }

  private liveFighter(
    memory: BrawlMemory,
    player: Match["players"][number],
  ): FightState["fighters"][number] {
    const result = memory.players[player.index];
    if (result === undefined) throw new Error("Brawl player result is missing");
    const owner = memory.owners.find(
      (entry) => entry.playerNo === (result.initial & 0xff),
    );
    const kos = result.kos;
    const falls = result.falls;
    return {
      seat: player.seat,
      human: player.human,
      characterId: player.characterId,
      damage: owner?.damage ?? null,
      stocks:
        owner === undefined || owner.stocks === 0xff_ff_ff_ff
          ? null
          : owner.stocks,
      // The rule's self-destruct penalty can alter the game's score.
      // Keep it unavailable until the native probe reads the authoritative score.
      score: null,
      kos,
      falls,
      selfDestructs: result.selfDestructs >>> 16,
      placement: null,
      winner: null,
    };
  }

  private result(memory: BrawlMemory, match: Match): FightState {
    const decision = memory.decision >>> 24;
    // A paused quit also enters results. It must never award a win.
    if (decision !== 1 && decision !== 2) {
      this.match = undefined;
      return this.empty("menu");
    }
    const fighters = match.players.map((player) => {
      const result = memory.players[player.index];
      if (result === undefined)
        throw new Error("Brawl player result is missing");
      const placement = ((result.rank >>> 8) & 0xff) + 1;
      return {
        ...this.liveFighter(memory, player),
        damage: null,
        stocks: null,
        placement,
        winner: placement === 1,
      };
    });
    return FightStateSchema.parse({
      family: "fighting",
      round: match.round,
      mode: match.mode,
      teams: match.teams,
      stageId: match.stageId,
      phase: "results",
      remainingMs: 0,
      fighters,
    });
  }

  private empty(phase: "menu" | "loading"): FightState {
    return {
      family: "fighting",
      phase,
      round: this.round,
      mode: "other",
      teams: false,
      stageId: null,
      remainingMs: null,
      fighters: [],
    };
  }
}
