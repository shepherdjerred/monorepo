// Reader for the committed `assets/patch-changes.generated.json` (see
// `patch-changes-schema.ts`).

import { z } from "zod";
import patchChangesData from "./assets/patch-changes.generated.json" with { type: "json" };
import {
  PatchChangesSchema,
  type PatchChangeLine,
  type PatchChangeSubject,
} from "#src/data-dragon/patch-changes-schema.ts";
import {
  selectRecentChanges,
  type RecentChangePatch,
  type RecentChangesQuery,
} from "#src/data-dragon/patch-changes-recent.ts";

export const patchChanges = PatchChangesSchema.parse(patchChangesData);

/** Every line touching one champion or item, newest patch first. */
export function getPatchChanges(
  kind: PatchChangeSubject["kind"],
  id: number,
): PatchChangeLine[] {
  const subjectId = z.number().int().positive().parse(id);
  return patchChanges.filter(
    (line) => line.subject.kind === kind && line.subject.id === subjectId,
  );
}

/**
 * A champion's changes over the newest `patches` patches in the notes, grouped
 * by patch, newest first. Unknown champions get an empty list.
 */
export function getRecentChampionChanges(
  query: RecentChangesQuery,
): RecentChangePatch[] {
  return selectRecentChanges(patchChanges, {
    ...query,
    championId: z.number().int().positive().parse(query.championId),
  });
}
