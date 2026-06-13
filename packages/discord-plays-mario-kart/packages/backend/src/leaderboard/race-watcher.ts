import type {
  GameMode,
  Mk64Snapshot,
  ScreenMode,
} from "#src/emulator/mk64-memory.ts";
import { COURSE_AWARD_CEREMONY } from "#src/emulator/mk64-memory.ts";

/**
 * Pure race-completion detector. Fed Mk64Snapshots (polled from RDRAM) plus
 * the current seat->name mapping; emits exactly one RaceCompleted per
 * racing -> finished cycle. No I/O, no emulator imports — unit-testable with
 * synthetic snapshots.
 *
 * Robustness model:
 * - A raceState transition is only trusted after `confirmPolls` consecutive
 *   identical observations (debounces garbage reads during scene loads).
 * - The roster (which seats are human, under which display name) is frozen at
 *   the racing transition, so disconnects or seat re-claims mid-race cannot
 *   reassign credit for a race driven under the original name.
 * - Per-player rank/time are captured at each player's own finish edge
 *   (hud raceCompleteBool 0->1): after finishing, the game flips the kart to
 *   CPU control and its live rank can drift.
 * - Battle mode and the Award Ceremony "course" are never recorded.
 */

export type RaceResultEntry = {
  seat: number;
  name: string | null;
  characterId: number;
  /** 1..8; for humans still mid-race when the outcome was decided, their live rank. */
  placement: number;
  raceTimeMs: number;
  /** False if the race outcome was decided before this player crossed the line. */
  finished: boolean;
};

export type RaceCompleted = {
  courseId: number;
  gameMode: GameMode;
  screenMode: ScreenMode;
  humanCount: number;
  results: RaceResultEntry[];
};

type SeatCapture = {
  name: string | null;
  characterId: number;
  finish: { placement: number; raceTimeMs: number } | undefined;
};

type Phase =
  | { kind: "idle" }
  | { kind: "racing"; race: TrackedRace }
  | { kind: "emitted" };

type TrackedRace = {
  courseId: number;
  gameMode: GameMode;
  screenMode: ScreenMode;
  humanCount: number;
  /** Keyed by player slot (= seat). */
  seats: Map<number, SeatCapture>;
};

export type RaceWatcherOptions = {
  /** Current display name per seat (index = seat), sampled at race start. */
  seatNames: () => (string | null)[];
  /** Consecutive identical raceState polls required to trust a transition. */
  confirmPolls?: number;
};

const DEFAULT_CONFIRM_POLLS = 3;

export class RaceWatcher {
  private readonly seatNames: () => (string | null)[];
  private readonly confirmPolls: number;
  private phase: Phase = { kind: "idle" };
  private pendingState: Mk64Snapshot["raceState"] | undefined;
  private pendingCount = 0;
  private confirmedState: Mk64Snapshot["raceState"] = "menu";

  constructor(opts: RaceWatcherOptions) {
    this.seatNames = opts.seatNames;
    this.confirmPolls = opts.confirmPolls ?? DEFAULT_CONFIRM_POLLS;
  }

  /** Feed one polled snapshot; returns a completed race exactly once per race. */
  update(snap: Mk64Snapshot): RaceCompleted | null {
    this.confirm(snap.raceState);

    switch (this.phase.kind) {
      case "idle": {
        if (this.confirmedState === "racing" && this.isRecordable(snap)) {
          this.phase = { kind: "racing", race: this.startRace(snap) };
        }
        return null;
      }
      case "racing": {
        const race = this.phase.race;
        this.captureFinishEdges(race, snap);

        const allFinished = [...race.seats.values()].every(
          (s) => s.finish !== undefined,
        );
        if (this.confirmedState === "finished" || allFinished) {
          this.phase = { kind: "emitted" };
          return this.finalize(race, snap);
        }
        if (
          this.confirmedState === "menu" ||
          this.confirmedState === "staging"
        ) {
          // Quit / reset / restart before the outcome was decided: discard.
          this.phase = { kind: "idle" };
        }
        return null;
      }
      case "emitted": {
        // Re-arm only once the game has left the post-race state, so sitting
        // on the results screen can never double-record.
        if (this.confirmedState !== "finished") {
          this.phase = { kind: "idle" };
        }
        return null;
      }
    }
  }

  private confirm(state: Mk64Snapshot["raceState"]): void {
    if (state === this.pendingState) {
      this.pendingCount++;
    } else {
      this.pendingState = state;
      this.pendingCount = 1;
    }
    if (this.pendingCount >= this.confirmPolls) {
      this.confirmedState = state;
    }
  }

  private isRecordable(snap: Mk64Snapshot): boolean {
    return (
      snap.gameMode !== "battle" &&
      snap.courseId >= 0 &&
      snap.courseId !== COURSE_AWARD_CEREMONY
    );
  }

  private startRace(snap: Mk64Snapshot): TrackedRace {
    const names = this.seatNames();
    const seats = new Map<number, SeatCapture>();
    snap.players.forEach((p, seat) => {
      if (p.present && p.human) {
        seats.set(seat, {
          name: names[seat] ?? null,
          characterId: p.characterId,
          finish: undefined,
        });
      }
    });
    return {
      courseId: snap.courseId,
      gameMode: snap.gameMode,
      screenMode: snap.screenMode,
      humanCount: seats.size,
      seats,
    };
  }

  private captureFinishEdges(race: TrackedRace, snap: Mk64Snapshot): void {
    for (const [seat, capture] of race.seats) {
      // Bounds-checked: a degraded ("menu") snapshot can have players: [].
      const p = seat < snap.players.length ? snap.players[seat] : undefined;
      if (p === undefined || capture.finish !== undefined) continue;
      if (p.finished && p.rank > 0) {
        capture.finish = { placement: p.rank, raceTimeMs: p.raceTimeMs };
      }
    }
  }

  private finalize(race: TrackedRace, snap: Mk64Snapshot): RaceCompleted {
    const results: RaceResultEntry[] = [];
    for (const [seat, capture] of race.seats) {
      if (capture.finish !== undefined) {
        results.push({
          seat,
          name: capture.name,
          characterId: capture.characterId,
          placement: capture.finish.placement,
          raceTimeMs: capture.finish.raceTimeMs,
          finished: true,
        });
        continue;
      }
      // Outcome decided before this player crossed the line (e.g. VS ends when
      // the second-to-last human finishes): record their live standing.
      const p = seat < snap.players.length ? snap.players[seat] : undefined;
      results.push({
        seat,
        name: capture.name,
        characterId: capture.characterId,
        placement: p !== undefined && p.rank > 0 ? p.rank : 8,
        raceTimeMs: p?.raceTimeMs ?? 0,
        finished: false,
      });
    }
    results.sort((a, b) => a.seat - b.seat);
    return {
      courseId: race.courseId,
      gameMode: race.gameMode,
      screenMode: race.screenMode,
      humanCount: race.humanCount,
      results,
    };
  }
}
