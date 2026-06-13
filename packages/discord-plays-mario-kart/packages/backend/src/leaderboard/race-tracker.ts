import { logger } from "#src/logger.ts";
import type { N64Emulator } from "#src/emulator/n64-emulator.ts";
import { readSnapshot } from "#src/emulator/mk64-memory.ts";
import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { RaceWatcher } from "./race-watcher.ts";
import type { RaceCompleted } from "./race-watcher.ts";
import type { LeaderboardStore } from "./store.ts";

export type RaceTrackerDeps = {
  emulator: N64Emulator;
  /** Current display name per seat (index = seat). */
  seatNames: () => (string | null)[];
  store: LeaderboardStore;
  /** Called after a race is recorded, so clients can be pushed a fresh board. */
  onRaceRecorded?: () => void;
  /** Poll cadence in frames (default 10 ≈ 3 Hz at 30fps). */
  pollEveryNFrames?: number;
};

/**
 * Impure glue between the per-frame emulator loop and the pure RaceWatcher.
 * Polls RDRAM every N frames, feeds snapshots to the watcher, and persists a
 * completed race fire-and-forget (never awaited in the frame loop). Also caches
 * the live screen mode for the name overlay's layout.
 */
export class RaceTracker {
  private readonly deps: RaceTrackerDeps;
  private readonly watcher: RaceWatcher;
  private readonly pollEveryNFrames: number;
  private frame = 0;
  private screenMode: ScreenMode | undefined;

  constructor(deps: RaceTrackerDeps) {
    this.deps = deps;
    this.pollEveryNFrames = deps.pollEveryNFrames ?? 10;
    this.watcher = new RaceWatcher({ seatNames: deps.seatNames });
  }

  /** The most recently observed MK64 screen mode (undefined until first read). */
  latestScreenMode(): ScreenMode | undefined {
    return this.screenMode;
  }

  /** Call once per emulated frame, from the composed onFrame callback. */
  onFrame(): void {
    this.frame++;
    if (this.frame % this.pollEveryNFrames !== 0) return;

    const mem = this.deps.emulator.rdram();
    if (mem === undefined) return;

    let completed;
    try {
      const snap = readSnapshot(mem);
      this.screenMode = snap.screenMode;
      completed = this.watcher.update(snap);
    } catch (error) {
      // A bad read must never break the frame loop.
      logger.warn("race snapshot read failed", error);
      return;
    }

    if (completed !== null) {
      logger.info(
        `race complete: course=${String(completed.courseId)} ` +
          `mode=${completed.gameMode} results=${String(completed.results.length)}`,
      );
      void this.persist(completed);
    }
  }

  private async persist(completed: RaceCompleted): Promise<void> {
    try {
      await this.deps.store.recordRace(completed);
      this.deps.onRaceRecorded?.();
    } catch (error) {
      logger.error("failed to persist race result", error);
    }
  }
}
