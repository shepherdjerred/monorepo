// Reader + relevance filter for the structured patch changeset.
//
// The changeset itself is produced offline by `scripts/patch-analysis.ts` (a
// `claude -p` pass over the raw patch notes) and committed as the bundled asset
// `assets/patch-notes.json`. At review time we read it here, cross-reference the
// changes against the reviewed player's champions / lane / items, and render a
// short targeted block for the personality prompt. All functions except
// `getPatchChangeset` (which reads the bundled asset) are pure and unit-tested.

import { z } from "zod";
import patchNotesData from "./assets/patch-notes.json" with { type: "json" };
import { normalizeChampionName } from "#src/data-dragon/images.ts";
import { getItemInfo } from "#src/data-dragon/item.ts";
import { type Lane } from "#src/model/lane.ts";

export const PatchDirectionSchema = z.enum([
  "buff",
  "nerf",
  "adjustment",
  "new",
  "removed",
]);
export type PatchDirection = z.infer<typeof PatchDirectionSchema>;

export const PatchMagnitudeSchema = z.enum(["minor", "moderate", "major"]);
export type PatchMagnitude = z.infer<typeof PatchMagnitudeSchema>;

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
export type PatchChampionChange = z.infer<typeof PatchChampionChangeSchema>;

export const PatchItemChangeSchema = PatchChangeSchema.extend({
  name: z.string().min(1),
});
export type PatchItemChange = z.infer<typeof PatchItemChangeSchema>;

export const PatchSystemChangeSchema = PatchChangeSchema.extend({
  area: z.string().min(1),
});
export type PatchSystemChange = z.infer<typeof PatchSystemChangeSchema>;

export const PatchChangesetSchema = z.object({
  patch: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  date: z.string().min(1),
  // Free-form narrative of the whole patch — used when nothing specific to the
  // player changed, so the reviewer still has something to riff on.
  overview: z.string().min(1),
  themes: z.array(z.string().min(1)).default([]),
  // Short highlight bullets — also consumed by the "What's New" changelog.
  summary: z.array(z.string().min(1)).min(1),
  champions: z.array(PatchChampionChangeSchema).default([]),
  items: z.array(PatchItemChangeSchema).default([]),
  systems: z.array(PatchSystemChangeSchema).default([]),
});
export type PatchChangeset = z.infer<typeof PatchChangesetSchema>;

export type RelevantPatchChanges = {
  champions: PatchChampionChange[];
  items: PatchItemChange[];
  systems: PatchSystemChange[];
};

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
        "reviews will run without patch context:",
      z.prettifyError(parsed.error),
    );
    return undefined;
  }
  return parsed.data;
}

const MAGNITUDE_ORDER: Record<PatchMagnitude, number> = {
  major: 0,
  moderate: 1,
  minor: 2,
};

function byMagnitude(
  a: { magnitude: PatchMagnitude },
  b: { magnitude: PatchMagnitude },
): number {
  return MAGNITUDE_ORDER[a.magnitude] - MAGNITUDE_ORDER[b.magnitude];
}

// Lane-relevant keywords used to decide whether a "systems" change touches the
// player's role. Keyed by the canonical Lane; matched case-insensitively against
// the system's area + summary text.
const LANE_KEYWORDS: Record<Lane, readonly string[]> = {
  top: ["top", "toplane", "top lane", "bruiser", "tank"],
  jungle: ["jungle", "jungler", "jgl", "monster", "objective", "epic monster"],
  middle: ["mid", "midlane", "mid lane", "mage", "assassin"],
  adc: ["adc", "bot", "botlane", "bot lane", "marksman", "carry"],
  support: ["support", "sup", "utility", "enchanter", "warding", "vision"],
};

// Changeset champion names are human-readable ("Lee Sin"); fact rows store Data
// Dragon keys ("LeeSin"). Normalize casing/alias quirks via the shared helper,
// then strip non-alphanumerics so the two representations compare equal.
function normalizeName(name: string): string {
  return normalizeChampionName(name)
    .replaceAll(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function playerItemNames(items: readonly number[]): Set<string> {
  const names = new Set<string>();
  for (const itemId of items) {
    const name = getItemInfo(itemId)?.name;
    if (name !== undefined && name.length > 0) {
      names.add(name.toLowerCase());
    }
  }
  return names;
}

function laneKeywordSet(lanes: readonly (Lane | undefined)[]): Set<string> {
  const keywords = new Set<string>();
  for (const lane of lanes) {
    if (lane !== undefined) {
      for (const keyword of LANE_KEYWORDS[lane]) {
        keywords.add(keyword);
      }
    }
  }
  return keywords;
}

/**
 * Keep only the changes that touch the reviewed player: their champions
 * (this-game + pool), their role, and the items they built. Each list is sorted
 * by magnitude (major first). Pure — no asset access.
 */
export function selectRelevantPatchChanges(
  changeset: PatchChangeset,
  player: {
    champions: readonly string[];
    lanes: readonly (Lane | undefined)[];
    items: readonly number[];
  },
): RelevantPatchChanges {
  const championKeys = new Set(
    player.champions.map((champion) => normalizeName(champion)),
  );
  const champions = changeset.champions
    .filter((change) => championKeys.has(normalizeName(change.name)))
    .toSorted(byMagnitude);

  const itemNames = playerItemNames(player.items);
  const items = changeset.items
    .filter((change) => itemNames.has(change.name.toLowerCase()))
    .toSorted(byMagnitude);

  const laneKeywords = laneKeywordSet(player.lanes);
  const systems = changeset.systems
    .filter((change) => {
      const haystack = `${change.area} ${change.summary}`.toLowerCase();
      return [...laneKeywords].some((keyword) => haystack.includes(keyword));
    })
    .toSorted(byMagnitude);

  return { champions, items, systems };
}

function directionTag(change: {
  direction: PatchDirection;
  magnitude: PatchMagnitude;
}): string {
  return `${change.direction}, ${change.magnitude}`;
}

// Keep the block short so it doesn't dominate the prompt.
const MAX_CHAMPIONS = 4;
const MAX_SYSTEMS = 3;
const MAX_ITEMS = 3;
const MAX_SUMMARY_BULLETS = 3;

/**
 * Render the targeted patch block. Uses the relevant subset when present,
 * otherwise falls back to the freeform overview + a couple of summary bullets so
 * the reviewer always has patch context when a changeset exists. Returns `""`
 * only when there is no changeset at all.
 */
export function formatPatchNotes(
  changeset: PatchChangeset | undefined,
  subset?: RelevantPatchChanges,
): string {
  if (changeset === undefined) {
    return "";
  }

  const lines: string[] = [`PATCH ${changeset.patch} — ${changeset.overview}`];

  const relevant = subset ?? { champions: [], items: [], systems: [] };
  const hasRelevant =
    relevant.champions.length > 0 ||
    relevant.items.length > 0 ||
    relevant.systems.length > 0;

  if (hasRelevant) {
    for (const champion of relevant.champions.slice(0, MAX_CHAMPIONS)) {
      lines.push(
        `${champion.name} (${directionTag(champion)}): ${champion.details}`,
      );
    }
    for (const system of relevant.systems.slice(0, MAX_SYSTEMS)) {
      lines.push(`${system.area} (${directionTag(system)}): ${system.details}`);
    }
    if (relevant.items.length > 0) {
      const itemText = relevant.items
        .slice(0, MAX_ITEMS)
        .map((item) => `${item.name} (${item.direction}): ${item.summary}`)
        .join("; ");
      lines.push(`Your build — ${itemText}`);
    }
    return lines.join("\n");
  }

  // Nothing specific to this player — fall back to the highlight bullets.
  for (const bullet of changeset.summary.slice(0, MAX_SUMMARY_BULLETS)) {
    lines.push(`- ${bullet}`);
  }
  return lines.join("\n");
}

/**
 * Generic (non-player-specific) patch context: overview + highlight bullets.
 * Used by callers that don't cross-reference against a player (e.g. the frontend
 * review tool) and as the default fallback in the review pipeline.
 */
export function formatGenericPatchNotes(
  changeset: PatchChangeset | undefined = getPatchChangeset(),
): string {
  return formatPatchNotes(changeset);
}
