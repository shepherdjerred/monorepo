// A champion's changes over the last few patches, grouped by patch. Pure over
// the parsed lines (`patch-changes-schema.ts`) so it never loads the JSON; the
// reader in `patch-changes.ts` binds it to the committed file.

import {
  overallDirection,
  type PatchChangeDirection,
} from "#src/data-dragon/patch-changes-direction.ts";
import type { PatchChangeLine } from "#src/data-dragon/patch-changes-schema.ts";

/** One before/after line of a patch group; the patch and date sit on the group. */
export type RecentChange = Omit<PatchChangeLine, "patch" | "date">;

export type RecentChangePatch = {
  /** Player-facing patch number, e.g. "26.23". */
  patch: string;
  /** Publish date of the notes, `YYYY-MM-DD`. */
  date: string;
  /**
   * The champion's own direction in this patch: buff or nerf when every one of
   * the champion's lines agrees, otherwise adjust. Item rows never count.
   */
  direction: PatchChangeDirection;
  /**
   * The champion's lines in notes order, then any requested item lines. Each
   * row keeps its own direction, so a champion buff next to an item nerf reads
   * as two different rows under one group direction.
   */
  changes: RecentChange[];
};

export type RecentChangesQuery = {
  championId: number;
  /** How many of the newest patches in the notes to look across. */
  patches: number;
  /**
   * Items whose lines are shown in the patches where the champion changed. The
   * notes do not tie an item to a champion, so the caller picks them, for
   * example the champion's core build.
   */
  itemIds?: readonly number[];
};

function patchOrder(patch: string): readonly [number, number] {
  const [season, number] = patch.split(".").map(Number);
  if (season === undefined || number === undefined) {
    throw new Error(`Malformed patch number ${patch}`);
  }
  return [season, number];
}

function newestFirst(left: string, right: string): number {
  const [leftSeason, leftNumber] = patchOrder(left);
  const [rightSeason, rightNumber] = patchOrder(right);
  return rightSeason - leftSeason || rightNumber - leftNumber;
}

function toChange(line: PatchChangeLine): RecentChange {
  return {
    subject: line.subject,
    ability: line.ability,
    stat: line.stat,
    before: line.before,
    after: line.after,
    direction: line.direction,
  };
}

/**
 * The champion's changes over the newest `patches` patches that appear in
 * `lines`, newest first. A patch where the champion has no line is left out; a
 * champion with no lines in the window, or an unknown one, gets an empty list.
 */
export function selectRecentChanges(
  lines: readonly PatchChangeLine[],
  query: RecentChangesQuery,
): RecentChangePatch[] {
  const { championId, patches, itemIds = [] } = query;
  if (!Number.isInteger(patches) || patches < 1) {
    throw new RangeError(
      `patches must be a positive integer: ${String(patches)}`,
    );
  }
  const window = new Set(
    [...new Set(lines.map((line) => line.patch))]
      .toSorted(newestFirst)
      .slice(0, patches),
  );

  const groups = new Map<
    string,
    { date: string; own: PatchChangeLine[]; items: PatchChangeLine[] }
  >();
  for (const line of lines) {
    if (!window.has(line.patch)) continue;
    const isOwn =
      line.subject.kind === "champion" && line.subject.id === championId;
    const isItem =
      line.subject.kind === "item" && itemIds.includes(line.subject.id);
    if (!isOwn && !isItem) continue;
    const group = groups.get(line.patch) ?? {
      date: line.date,
      own: [],
      items: [],
    };
    (isOwn ? group.own : group.items).push(line);
    groups.set(line.patch, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.own.length > 0)
    .toSorted(([left], [right]) => newestFirst(left, right))
    .map(([patch, group]) => ({
      patch,
      date: group.date,
      direction: overallDirection(group.own.map((line) => line.direction)),
      changes: [...group.own, ...group.items].map((line) => toChange(line)),
    }));
}
