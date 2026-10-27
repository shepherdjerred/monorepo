// Schema and readers for the structured patch changeset used by Explore.
//
// The changeset itself is produced offline by `scripts/patch-analysis.ts` (a
// Opus structured pass over the official patch notes) and committed as the bundled asset
// `assets/patch-notes.json`. Explore reads the current and historical changesets
// as structured league-reference data.

import { z } from "zod";
import patchNotesData from "./assets/patch-notes.json" with { type: "json" };
import patchNotesHistoryData from "./assets/patch-notes-history.json" with { type: "json" };

export const PatchDirectionSchema = z.enum([
  "buff",
  "nerf",
  "adjustment",
  "new",
  "removed",
]);

export const PatchMagnitudeSchema = z.enum(["minor", "moderate", "major"]);

// A single balance change: a short label plus free-form prose explaining why it
// matters to a player. `direction`/`magnitude` let the filter rank and phrase it.
const PatchChangeSchema = z.object({
  direction: PatchDirectionSchema,
  magnitude: PatchMagnitudeSchema,
  summary: z.string().min(1),
  details: z.string().min(1),
});

export const PatchChampionChangeSchema = PatchChangeSchema.extend({
  name: z.string().min(1),
});

export const PatchItemChangeSchema = PatchChangeSchema.extend({
  name: z.string().min(1),
});

export const PatchSystemChangeSchema = PatchChangeSchema.extend({
  area: z.string().min(1),
});

export const PatchChangesetSchema = z.object({
  patch: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  date: z.string().min(1),
  // Free-form narrative of the whole patch for league-reference analysis.
  overview: z.string().min(1),
  themes: z.array(z.string().min(1)).default([]),
  // Short, balance-focused highlight bullets — consumed by Scout analysis.
  summary: z.array(z.string().min(1)).min(1),
  // Scout-capability-focused bullets for the public "What's New" changelog,
  // kept separate from the balance-focused `summary`.
  // Usually empty — most patches only refresh data. `.default([])` keeps older
  // committed patch-notes.json assets (written before this field existed) valid.
  changelogHighlights: z.array(z.string().min(1)).max(4).default([]),
  champions: z.array(PatchChampionChangeSchema).default([]),
  items: z.array(PatchItemChangeSchema).default([]),
  systems: z.array(PatchSystemChangeSchema).default([]),
});
export type PatchChangeset = z.infer<typeof PatchChangesetSchema>;
export const PatchChangesetHistorySchema = z.array(PatchChangesetSchema);

/**
 * Read + validate the bundled patch changeset. Returns `undefined` when the
 * asset fails validation so callers degrade gracefully (patch context is a
 * best-effort enrichment, and the `update-data-dragon` job ships the asset PR
 * even when the changeset couldn't be refreshed). The failure is logged loudly
 * rather than swallowed, so a corrupt committed asset is still visible.
 */
export function getPatchChangeset(): PatchChangeset | undefined {
  const parsed = PatchChangesetSchema.safeParse(patchNotesData);
  if (!parsed.success) {
    console.error(
      "[patch-notes] bundled patch-notes.json failed validation; " +
        "patch context is unavailable:",
      z.prettifyError(parsed.error),
    );
    return undefined;
  }
  return parsed.data;
}

export function getPatchChangesets(): PatchChangeset[] {
  return PatchChangesetHistorySchema.parse(patchNotesHistoryData);
}
