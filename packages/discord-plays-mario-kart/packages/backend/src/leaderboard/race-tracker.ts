import { logger } from "#src/logger.ts";
import type { Mk64Snapshot } from "#src/emulator/mk64-memory.ts";
import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { RaceWatcher } from "./race-watcher.ts";
import type { RaceCompleted } from "./race-watcher.ts";
import type { LeaderboardStore } from "./store.ts";

export type RaceTrackerDeps = {
  /** Current display name per seat (index = seat). */
  seatNames: () => (string | null)[];
  store: LeaderboardStore;
  /** Called after a race is recorded, so clients can be pushed a fresh board. */
  onRaceRecorded?: () => void;
};

/**
 * Impure glue between the emulator's race snapshots and the pure RaceWatcher.
 * Snapshots are decoded in the emulator's Worker thread (RDRAM lives there)
 * and arrive here via WorkerEmulator.onSnapshot; this feeds them to the
 * watcher and persists a completed race fire-and-forget (never awaited on the
 * frame path). Also caches the live screen mode for the name overlay's layout.
 */
export class RaceTracker {
  private readonly deps: RaceTrackerDeps;
  private readonly watcher: RaceWatcher;
  private screenMode: ScreenMode | undefined;

  constructor(deps: RaceTrackerDeps) {
    this.deps = deps;
    this.watcher = new RaceWatcher({ seatNames: deps.seatNames });
  }

  /** The most recently observed MK64 screen mode (undefined until first read). */
  latestScreenMode(): ScreenMode | undefined {
    return this.screenMode;
  }

  /** Feed one decoded snapshot (posted by the emulator worker). */
  updateFromSnapshot(snap: Mk64Snapshot): void {
    let completed;
    try {
      this.screenMode = snap.screenMode;
      completed = this.watcher.update(snap);
    } catch (error) {
      // A bad update must never break the frame pipeline.
      logger.warn("race snapshot update failed", error);
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
