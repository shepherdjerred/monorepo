import type {
  FightState,
  GameState,
  RaceState,
} from "@arcade/common/telemetry.ts";
import type { GameId, Player } from "@arcade/common/catalog.ts";
import type { StatsStore } from "./store.ts";

type Round = {
  number: number;
  players: readonly (Player | null)[];
  race: RaceState | undefined;
  fight: FightState | undefined;
  recorded: boolean;
};

/** Observes game transitions; storage runs outside the frame callback. */
export class ResultTracker {
  private round: Round | undefined;
  private readonly pending = new Map<symbol, Promise<void>>();
  private readonly failures: unknown[] = [];

  constructor(
    private readonly options: {
      gameId: Exclude<GameId, "emerald">;
      guildId: string;
      sessionId: string;
      players: () => readonly (Player | null)[];
      store: Pick<StatsStore, "recordRace" | "recordFight">;
      recorded: () => void;
      failed: (error: Error) => void;
    },
  ) {}

  update(state: GameState): void {
    if (state.family === "pokemon")
      throw new Error("result tracker received Pokémon state");
    if (
      state.phase === "menu" ||
      state.phase === "staging" ||
      state.phase === "loading"
    ) {
      this.round = undefined;
      return;
    }
    const playing =
      state.family === "racing"
        ? state.phase === "racing"
        : state.phase === "playing";
    if (playing && this.round?.number !== state.round) {
      this.round = {
        number: state.round,
        players: [...this.options.players()],
        race: state.family === "racing" ? structuredClone(state) : undefined,
        fight: state.family === "fighting" ? structuredClone(state) : undefined,
        recorded: false,
      };
    }
    const round = this.round;
    if (round?.number !== state.round || round.recorded) return;
    if (state.family === "racing") this.updateRace(round, state);
    else this.updateFight(round, state);
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending.values());
    if (this.failures.length > 0)
      throw new AggregateError(this.failures, "game results were not saved");
  }

  private updateRace(round: Round, state: RaceState): void {
    const start = round.race;
    const gameId = this.options.gameId;
    if (start === undefined || (gameId !== "mk64" && gameId !== "mkwii"))
      throw new Error("race adapter mismatch");
    if (state.mode === "battle") return;
    for (const racer of start.racers) {
      if (!racer.human || racer.finished) continue;
      const live = state.racers.find((current) => current.slot === racer.slot);
      if (live === undefined) continue;
      racer.lap = live.lap;
      racer.placement = live.placement;
      racer.timeMs = live.timeMs;
      racer.finished = live.finished;
    }
    const humans = start.racers.filter((racer) => racer.human);
    if (
      humans.length === 0 ||
      (state.phase !== "finished" && !humans.every((racer) => racer.finished))
    )
      return;
    round.recorded = true;
    start.phase = "finished";
    this.persist(() =>
      this.options.store.recordRace(
        { guildId: this.options.guildId, gameId, roundId: this.roundId(round) },
        start,
        round.players,
      ),
    );
  }

  private updateFight(round: Round, state: FightState): void {
    const gameId = this.options.gameId;
    if (gameId !== "melee" && gameId !== "brawl")
      throw new Error("fighting adapter mismatch");
    if (state.phase !== "results" || state.teams || state.mode === "other")
      return;
    const result = structuredClone(state);
    for (const fighter of result.fighters) {
      const original = round.fight?.fighters.find(
        (entry) => entry.seat === fighter.seat,
      );
      if (original === undefined)
        throw new Error("match result contains an unknown player slot");
      fighter.characterId = original.characterId;
      fighter.human = original.human;
    }
    round.recorded = true;
    this.persist(() =>
      this.options.store.recordFight(
        { guildId: this.options.guildId, gameId, roundId: this.roundId(round) },
        result,
        round.players,
      ),
    );
  }

  private roundId(round: Round): string {
    return `${this.options.sessionId}:${String(round.number)}`;
  }

  private persist(write: () => Promise<void>): void {
    const writeId = Symbol("round result");
    const task = (async () => {
      // Leave the emulation callback before starting database work.
      await Promise.resolve();
      try {
        await write();
        this.options.recorded();
      } catch (error) {
        this.failures.push(error);
        try {
          this.options.failed(
            error instanceof Error ? error : new Error(String(error)),
          );
        } catch (reportError) {
          this.failures.push(reportError);
        }
      } finally {
        this.pending.delete(writeId);
      }
    })();
    this.pending.set(writeId, task);
  }
}
