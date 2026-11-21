import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { RemovalList } from "#shared/api.ts";
import type { RemovalHistoryItemSchema } from "#shared/household/calendar.ts";
import {
  removalPhase,
  type RemovalPhase,
} from "#client/presentation/removal.ts";
import { REMOVALS_READ } from "./reads.ts";

export type Removal = RemovalList[number];
export type RemovedItem = z.infer<typeof RemovalHistoryItemSchema>;

/** The removals read, as every view of the Library uses it. */
export function useRemovals() {
  return useQuery(REMOVALS_READ);
}

export type LeavingRow = {
  removal: Removal;
  phase: Exclude<RemovalPhase, "quarantined">;
  /** The row is the film or series itself, not a season or episode of it. */
  whole: boolean;
};

export type LeavingTitle = {
  rootMediaId: string;
  /** The film or series the rows belong to. */
  name: string;
  posterPath: string | null;
  /** The first date anything of the title leaves; null while none is set. */
  leavesAt: string | null;
  rows: LeavingRow[];
};

function soonest(rows: readonly LeavingRow[]): string | null {
  const dates = rows.flatMap((row) =>
    row.removal.graceUntil === null ? [] : [row.removal.graceUntil],
  );
  // ISO timestamps sort as text.
  return dates.toSorted((left, right) => left.localeCompare(right))[0] ?? null;
}

/**
 * Pending removals as one entry per film or series, soonest first. Removals
 * whose files are already out of the library are not leaving; they are
 * `restorable`.
 */
export function leavingTitles(removals: readonly Removal[]): LeavingTitle[] {
  const groups = new Map<string, LeavingRow[]>();
  for (const removal of removals) {
    const phase = removalPhase(removal.state);
    if (phase === "quarantined") continue;
    const rows = groups.get(removal.rootMediaId) ?? [];
    rows.push({
      removal,
      phase,
      whole: removal.mediaId === removal.rootMediaId,
    });
    groups.set(removal.rootMediaId, rows);
  }
  return [...groups.values()]
    .flatMap((rows): LeavingTitle[] => {
      const [first] = rows;
      if (first === undefined) return [];
      return [
        {
          rootMediaId: first.removal.rootMediaId,
          name: first.removal.rootTitle,
          posterPath: first.removal.artwork.posterPath,
          leavesAt: soonest(rows),
          rows,
        },
      ];
    })
    .sort((left, right) => {
      // Dated removals first, soonest at the top; undated ones after.
      if (left.leavesAt !== null && right.leavesAt !== null)
        return left.leavesAt.localeCompare(right.leavesAt);
      if (left.leavesAt !== null) return -1;
      return right.leavesAt === null ? 0 : 1;
    });
}

/** Removals whose files left the library and can still be put back. */
function restorable(removals: readonly Removal[]): Removal[] {
  return removals.filter(
    (removal) => removalPhase(removal.state) === "quarantined",
  );
}

/**
 * Where the restore control goes in the removal history.
 *
 * The control restores a title's default version, and the removal list is
 * what says the reader may: it holds the set-aside removals of default
 * versions that are theirs to undo. A history row and a listed removal are
 * the same retention decision exactly when they carry the same id, so that
 * is the match. The title alone is not: a film's default version and one of
 * its cuts can both be set aside, and the cut's row must not get a control
 * that would restore the other version.
 *
 * `rows` are the history rows that carry the control. `unlisted` are the
 * restorable removals no history row shown so far stands for; they are
 * listed on their own so the action never depends on how much history has
 * been loaded. `targets` are the titles whose default-target view the
 * controls need.
 */
export function restoreControls(
  history: readonly RemovedItem[],
  removals: readonly Removal[],
): { rows: ReadonlySet<string>; unlisted: Removal[]; targets: string[] } {
  const undoable = restorable(removals);
  const decisions = new Set(undoable.map((removal) => removal.id));
  const rows = new Set(
    history
      .filter(
        (item) => item.restoreState === "recoverable" && decisions.has(item.id),
      )
      .map((item) => item.id),
  );
  return {
    rows,
    unlisted: undoable.filter((removal) => !rows.has(removal.id)),
    targets: [...new Set(undoable.map((removal) => removal.mediaId))],
  };
}
