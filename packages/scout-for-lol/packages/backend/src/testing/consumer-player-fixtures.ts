import { vi } from "vitest";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

/**
 * Shared setup for the consumer player router suites. The player seed lives in
 * `consumer-player-seed.ts`.
 */

/**
 * The module replacement for `#src/report-lake/receipted-archive.ts`: the
 * live view reads each captured game's roster from its archived spectator
 * snapshot, and the object store is not part of these suites. Use from a
 * `vi.mock` factory with a `vi.hoisted` map of snapshots by match id.
 */
export async function stubArchivedPrematchSnapshots(
  snapshots: ReadonlyMap<string, object>,
) {
  const actual: object = await vi.importActual(
    "#src/report-lake/receipted-archive.ts",
  );
  return {
    ...actual,
    readArchivedPrematchSnapshot: (
      _descriptor: unknown,
      matchId: RiotMatchId,
    ) => {
      const snapshot = snapshots.get(matchId);
      if (snapshot === undefined) {
        throw new Error(`No archived snapshot stubbed for ${matchId}`);
      }
      return Promise.resolve(snapshot);
    },
  };
}
