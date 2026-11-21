import { useQuery } from "@tanstack/react-query";
import { RemovalListSchema, type RemovalList } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import {
  removalPhase,
  type RemovalPhase,
} from "#client/presentation/removal.ts";

export type Removal = RemovalList[number];

/**
 * Removals that are pending or can still be undone. Leaving soon lists the
 * pending ones, Removed the ones already out of the library, and the page
 * header counts the first, so all three share this one read.
 */
export function useRemovals() {
  return useQuery({
    queryKey: ["removals"],
    queryFn: () => readApi("/removals", RemovalListSchema),
    refetchInterval: 15_000,
  });
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
export function restorable(removals: readonly Removal[]): Removal[] {
  return removals.filter(
    (removal) => removalPhase(removal.state) === "quarantined",
  );
}
