import { z } from "zod";
import {
  ChampionMetaFileSchema,
  ChampionSliceSchema as FullChampionSliceSchema,
  MetaRoleSchema,
  type MetaBracket,
  type MetaRole,
} from "@scout-for-lol/data/meta/meta-serving.ts";

/**
 * The committed champion-meta snapshot the static champion pages are built
 * from, and the schemas of the meta API responses it is refreshed from
 * (`GET /api/meta/v1/{manifest,champions/:id}`, served by the backend's
 * `http/meta-routes.ts`).
 *
 * The response schemas are the API's own, shared through
 * `@scout-for-lol/data`; the snapshot keeps the slices without item lift.
 * The API already enforces its minimum samples: a slice, build or rune entry
 * that failed the floor is never returned, and nothing here re-derives or
 * relaxes that.
 */

export const CHAMPION_META_SNAPSHOT_VERSION = 1;

const ROLES = MetaRoleSchema.options;

/** What the pages show: a served slice without the item-lift tables. */
export const ChampionSliceSchema = FullChampionSliceSchema.omit({
  itemLift: true,
});
export type ChampionSlice = z.infer<typeof ChampionSliceSchema>;

export const ChampionResponseSchema = ChampionMetaFileSchema.extend({
  slices: z.array(ChampionSliceSchema),
});

/** Lowercase, ASCII, hyphenated: `Kai'Sa` is `kaisa`, `Nunu & Willump` is `nunu-willump`. */
export function championSlug(name: string): string {
  return name
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/['’.]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

const ChampionEntrySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  slug: z.string().min(1),
  slices: z.array(ChampionSliceSchema).min(1),
});
export type ChampionEntry = z.infer<typeof ChampionEntrySchema>;

export const ChampionMetaSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CHAMPION_META_SNAPSHOT_VERSION),
    /** Where the numbers came from; null while the API has published nothing. */
    source: z
      .object({
        buildId: z.string(),
        generatedAt: z.iso.datetime(),
        firstDay: z.string(),
        lastDay: z.string(),
        minSliceGames: z.number().int(),
      })
      .nullable(),
    caveats: z.array(z.string()),
    champions: z.array(ChampionEntrySchema),
  })
  .superRefine((snapshot, context) => {
    const slugs = new Set<string>();
    for (const champion of snapshot.champions) {
      if (champion.slug !== championSlug(champion.name)) {
        context.addIssue({
          code: "custom",
          message: `Slug ${champion.slug} does not match ${champion.name}`,
        });
      }
      if (slugs.has(champion.slug)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate champion slug ${champion.slug}`,
        });
      }
      slugs.add(champion.slug);
    }
    if (snapshot.champions.length > 0 && snapshot.source === null) {
      context.addIssue({
        code: "custom",
        message: "A snapshot with champions must name its source",
      });
    }
  });
export type ChampionMetaSnapshot = z.infer<typeof ChampionMetaSnapshotSchema>;

export const EMPTY_CHAMPION_META_SNAPSHOT: ChampionMetaSnapshot = {
  schemaVersion: CHAMPION_META_SNAPSHOT_VERSION,
  source: null,
  caveats: [],
  champions: [],
};

export function parseChampionMetaSnapshot(raw: unknown): ChampionMetaSnapshot {
  return ChampionMetaSnapshotSchema.parse(raw);
}

export function hasChampions(snapshot: ChampionMetaSnapshot): boolean {
  return snapshot.champions.length > 0;
}

const ROLE_LABELS: Record<MetaRole, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

export function roleLabel(role: MetaRole): string {
  return ROLE_LABELS[role];
}

export function roleSlug(role: MetaRole): string {
  return role.toLowerCase();
}

export function roleFromSlug(slug: string): MetaRole | undefined {
  const parsed = MetaRoleSchema.safeParse(slug.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

/** Roles a champion has a slice for, most played first. */
export function championRoles(champion: ChampionEntry): ChampionSlice[] {
  return champion.slices.toSorted(
    (left, right) =>
      right.sample.games - left.sample.games ||
      ROLES.indexOf(left.context.role) - ROLES.indexOf(right.context.role),
  );
}

const QUEUE_LABELS: Record<string, string> = {
  ranked_solo: "Ranked Solo/Duo",
  ranked_flex: "Ranked Flex",
  normal_draft: "Normal Draft",
};

const BRACKET_LABELS: Record<MetaBracket, string> = {
  all: "all ranks",
  low: "Iron to Silver",
  mid: "Gold to Platinum",
  high: "Emerald to Diamond",
  master_plus: "Master and above",
};

/** "from 1,204 games · patch 16.3 · Ranked Solo/Duo · all ranks". */
export function evidenceLine(games: number, context: ChampionSlice["context"]) {
  const queue = QUEUE_LABELS[context.queue];
  if (queue === undefined) {
    throw new Error(`Unknown meta queue label ${context.queue}`);
  }
  return `from ${games.toLocaleString("en-US")} games · patch ${context.patch} · ${queue} · ${BRACKET_LABELS[context.bracket]}`;
}

export function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** The up-to-three builds the page shows side by side. */
export function topBuilds(slice: ChampionSlice): ChampionSlice["buildPaths"] {
  return slice.buildPaths.toSorted((a, b) => b.games - a.games).slice(0, 3);
}
