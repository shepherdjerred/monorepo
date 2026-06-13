import type { MemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import { logger } from "#src/logger.ts";
import { snapshotInvalidTotal } from "#src/observability/metrics.ts";
import { diffSnapshots, MAX_EVENTS_PER_DIFF } from "./diff.ts";
import { readGameSnapshot } from "./snapshot.ts";
import type { GameEvent } from "./types.ts";

export type GameEventWatcher = {
  /** Read the current state and return events since the last valid poll. */
  poll: () => GameEvent[];
};

export function createGameEventWatcher(deps: {
  reader: MemoryReader;
  symbols: GameSymbols;
}): GameEventWatcher {
  // The last snapshot we successfully read. Events are always diffed against
  // this, so an invalid poll (no save loaded, torn read) is simply skipped and
  // the baseline is preserved — events that straddle the gap still fire.
  let baseline = readGameSnapshot(deps.reader, deps.symbols);

  return {
    poll(): GameEvent[] {
      const next = readGameSnapshot(deps.reader, deps.symbols);
      if (next === null) {
        snapshotInvalidTotal.inc();
        return [];
      }
      if (baseline === null) {
        baseline = next; // first valid snapshot is the baseline, no events
        return [];
      }

      const events = diffSnapshots(baseline, next);
      baseline = next;

      if (events.length > MAX_EVENTS_PER_DIFF) {
        logger.warn(
          `dropping ${String(events.length)} game events from one diff ` +
            "(likely a save reload), advancing baseline",
        );
        return [];
      }
      return events;
    },
  };
}
